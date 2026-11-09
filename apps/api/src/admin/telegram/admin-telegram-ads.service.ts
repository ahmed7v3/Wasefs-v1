import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";


import { pickAdImage } from "../../ads/ads-image.js";
import { API_ENV } from "../../config/config.module.js";
import { SettingsService } from "../../settings/settings.service.js";
import { isMedicineCategory } from "../../telegram-bot/telegram-ads-selection.js";
import { isTelegramAdTrigger, withRates } from "../../telegram-bot/telegram-ads-stats.js";
import { TelegramAdsRepo } from "../../telegram-bot/telegram-ads.repo.js";
import { TelegramAdsService } from "../../telegram-bot/telegram-ads.service.js";
import { TelegramApiClient } from "../../telegram-bot/telegram-api.client.js";
import { TelegramTokenService } from "../../telegram-bot/telegram-token.service.js";
import { csvRow } from "../ai/usage-csv.js";

import { AdminTelegramRepo } from "./admin-telegram.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { ApiEnv } from "../../config/env.js";
import type {
  NewTelegramAdCampaign,
  NewTelegramAdCreative,
  TelegramAdCampaignListRow,
  TelegramAdCreativeAdminRow,
} from "@wasfa/db";
import type {
  TelegramAdCampaign,
  TelegramAdCreative,
  TelegramAdStats,
  telegramAdCampaignInputSchema,
  telegramAdCreativeInputSchema,
  telegramAdStatsQuerySchema,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import type { TelegramAdsSettings } from "@wasfa/shared/telegram-ads";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";

type CampaignInput = Partial<z.input<typeof telegramAdCampaignInputSchema>>;
type CreativeInput = Partial<z.input<typeof telegramAdCreativeInputSchema>>;
type StatsQuery = z.output<typeof telegramAdStatsQuerySchema>;

const PREVIEW_WIDTH = 640;
const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function validationFailed(...fields: string[]): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields } });
}

const notFound = () => new AppError(ErrorCode.NOT_FOUND);
const iso = (date: Date | null) => (date === null ? null : date.toISOString());
const dateOf = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/**
 * The console behind `/admin/telegram/ads`. Independent of `AdminAdsService` (web/WhatsApp ads): its
 * own settings key, tables and analytics. The medicine floor is enforced here as well as at delivery
 * and in the database; every write fills the audit scope (settings are audited by `SettingsService`).
 */
@Injectable()
export class AdminTelegramAdsService {
  constructor(
    private readonly repo: TelegramAdsRepo,
    private readonly ads: TelegramAdsService,
    private readonly settings: SettingsService,
    private readonly chats: AdminTelegramRepo,
    private readonly tokens: TelegramTokenService,
    private readonly client: TelegramApiClient,
    @Inject(API_ENV) private readonly env: Pick<ApiEnv, "MEDIA_PUBLIC_ORIGIN">,
  ) {}

  // --- settings ---------------------------------------------------------------------------------

  getSettings(): Promise<TelegramAdsSettings> {
    return this.settings.get("telegramAds");
  }

  async putSettings(
    actorId: string,
    request: FastifyRequest,
    input: unknown,
  ): Promise<TelegramAdsSettings> {
    await this.settings.set("telegramAds", input, { actorId, request });
    return this.getSettings();
  }

  // --- campaigns --------------------------------------------------------------------------------

  private toCampaign(row: TelegramAdCampaignListRow): TelegramAdCampaign {
    const { campaign } = row;
    return {
      id: campaign.id,
      name: campaign.name,
      advertiser: campaign.advertiser,
      status: campaign.status,
      startsAt: iso(campaign.startsAt),
      endsAt: iso(campaign.endsAt),
      dailyImpressionCap: campaign.dailyImpressionCap,
      totalImpressionCap: campaign.totalImpressionCap,
      notes: campaign.notes,
      creativeCount: row.creativeCount,
      impressions: row.impressions,
      clicks: row.clicks,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    };
  }

  async listCampaigns(): Promise<{ items: TelegramAdCampaign[] }> {
    return { items: (await this.repo.campaigns()).map((row) => this.toCampaign(row)) };
  }

  async createCampaign(input: CampaignInput, audit: AuditScope): Promise<TelegramAdCampaign> {
    this.assertSchedule(input.startsAt, input.endsAt);
    const row = await this.repo.createCampaign(this.campaignValues(input) as NewTelegramAdCampaign);
    audit.targetId = row.id;
    audit.after = { name: row.name, status: row.status };
    this.ads.invalidate();
    return this.campaignOrThrow(row.id);
  }

  async updateCampaign(
    id: string,
    input: CampaignInput,
    audit: AuditScope,
  ): Promise<TelegramAdCampaign> {
    const current = await this.repo.campaign(id);
    if (current === null) throw notFound();
    const startsAt =
      input.startsAt === undefined ? iso(current.campaign.startsAt) : input.startsAt;
    const endsAt = input.endsAt === undefined ? iso(current.campaign.endsAt) : input.endsAt;
    this.assertSchedule(startsAt, endsAt);
    await this.repo.updateCampaign(id, this.campaignValues(input));
    audit.before = { name: current.campaign.name, status: current.campaign.status };
    audit.after = input;
    this.ads.invalidate();
    return this.campaignOrThrow(id);
  }

  async deleteCampaign(id: string, audit: AuditScope): Promise<void> {
    const current = await this.repo.campaign(id);
    if (current === null || !(await this.repo.deleteCampaign(id))) throw notFound();
    audit.before = { name: current.campaign.name, creatives: current.creativeCount };
    this.ads.invalidate();
  }

  private async campaignOrThrow(id: string): Promise<TelegramAdCampaign> {
    const row = await this.repo.campaign(id);
    if (row === null) throw notFound();
    return this.toCampaign(row);
  }

  private campaignValues(input: CampaignInput): Partial<NewTelegramAdCampaign> {
    const { startsAt, endsAt, ...rest } = input;
    return {
      ...rest,
      ...(startsAt === undefined ? {} : { startsAt: dateOf(startsAt) ?? null }),
      ...(endsAt === undefined ? {} : { endsAt: dateOf(endsAt) ?? null }),
    };
  }

  // --- creatives --------------------------------------------------------------------------------

  private toCreative(row: TelegramAdCreativeAdminRow): TelegramAdCreative {
    const { creative } = row;
    return {
      id: creative.id,
      campaignId: creative.campaignId,
      name: creative.name,
      status: creative.status,
      layout: creative.layout,
      headline: creative.headline,
      body: creative.body,
      imageMediaId: creative.imageMediaId,
      imageUrl: pickAdImage(row.media, PREVIEW_WIDTH, this.env.MEDIA_PUBLIC_ORIGIN)?.url ?? null,
      buttons: creative.buttons,
      buttonsPerRow: creative.buttonsPerRow === 2 ? 2 : 1,
      category: creative.category,
      weight: creative.weight,
      startsAt: iso(creative.startsAt),
      endsAt: iso(creative.endsAt),
      targeting: creative.targeting,
      impressions: row.impressions,
      clicks: row.clicks,
      createdAt: creative.createdAt.toISOString(),
      updatedAt: creative.updatedAt.toISOString(),
    };
  }

  async listCreatives(campaignId?: string): Promise<{ items: TelegramAdCreative[] }> {
    return { items: (await this.repo.creatives(campaignId)).map((row) => this.toCreative(row)) };
  }

  async createCreative(input: CreativeInput, audit: AuditScope): Promise<TelegramAdCreative> {
    if (input.campaignId === undefined || (await this.repo.campaign(input.campaignId)) === null) {
      throw validationFailed("campaignId");
    }
    this.assertSchedule(input.startsAt, input.endsAt);
    this.assertFloor(input.status, input.category);
    if (input.imageMediaId) await this.assertImage(input.imageMediaId);
    const row = await this.repo.createCreative(this.creativeValues(input) as NewTelegramAdCreative);
    audit.targetId = row.id;
    audit.after = { name: row.name, status: row.status, campaignId: row.campaignId };
    this.ads.invalidate();
    return this.creativeOrThrow(row.id);
  }

  async updateCreative(
    id: string,
    input: CreativeInput,
    audit: AuditScope,
  ): Promise<TelegramAdCreative> {
    const current = await this.repo.creative(id);
    if (current === null) throw notFound();
    const { creative } = current;
    if (input.campaignId !== undefined && (await this.repo.campaign(input.campaignId)) === null) {
      throw validationFailed("campaignId");
    }
    this.assertSchedule(
      input.startsAt === undefined ? iso(creative.startsAt) : input.startsAt,
      input.endsAt === undefined ? iso(creative.endsAt) : input.endsAt,
    );
    this.assertFloor(input.status ?? creative.status, input.category ?? creative.category);
    if (input.imageMediaId && input.imageMediaId !== creative.imageMediaId) {
      await this.assertImage(input.imageMediaId);
    }
    await this.repo.updateCreative(id, this.creativeValues(input));
    audit.before = { name: creative.name, status: creative.status };
    audit.after = { fields: Object.keys(input) };
    this.ads.invalidate();
    return this.creativeOrThrow(id);
  }

  async setCreativeStatus(
    id: string,
    status: NewTelegramAdCreative["status"],
    audit: AuditScope,
  ): Promise<TelegramAdCreative> {
    const current = await this.repo.creative(id);
    if (current === null) throw notFound();
    this.assertFloor(status, current.creative.category);
    await this.repo.updateCreative(id, { status });
    audit.before = { status: current.creative.status };
    audit.after = { status };
    this.ads.invalidate();
    return this.creativeOrThrow(id);
  }

  async deleteCreative(id: string, audit: AuditScope): Promise<void> {
    const current = await this.repo.creative(id);
    if (current === null || !(await this.repo.deleteCreative(id))) throw notFound();
    audit.before = { name: current.creative.name, status: current.creative.status };
    this.ads.invalidate();
  }

  /**
   * Sends the creative, as delivery would render it, to the acting admin's own linked chats. Plain
   * (untracked) links: a preview is never a click, and its buttons record no events.
   */
  async testSend(actorId: string, id: string): Promise<{ sent: number }> {
    const current = await this.repo.creative(id);
    if (current === null) throw notFound();
    const token = await this.tokens.get();
    if (token === null) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "token_missing" } });
    }
    const chats = await this.chats.chatsOfUser(actorId);
    if (chats.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "no_linked_chat" } });
    }
    const api = this.client.bind(token);
    const settings = await this.settings.get("telegramAds");
    let sent = 0;
    for (const chat of chats) {
      try {
        await this.ads.send(api, chat.chatId, current, {
          locale: chat.locale,
          trigger: "after_rx_done",
          settings,
          now: new Date(),
          tracked: false,
        });
        sent += 1;
      } catch {
        // A chat that blocked the bot is skipped; the count tells the admin what arrived.
      }
    }
    return { sent };
  }

  private async creativeOrThrow(id: string): Promise<TelegramAdCreative> {
    const row = await this.repo.creative(id);
    if (row === null) throw notFound();
    return this.toCreative(row);
  }

  private creativeValues(input: CreativeInput): Partial<NewTelegramAdCreative> {
    const { startsAt, endsAt, targeting, buttons, ...rest } = input;
    return {
      ...rest,
      ...(buttons === undefined ? {} : { buttons }),
      ...(targeting === undefined
        ? {}
        : {
            targeting: {
              locales: targeting.locales ?? [],
              audience: targeting.audience ?? "all",
              triggers: targeting.triggers ?? [],
            },
          }),
      ...(startsAt === undefined ? {} : { startsAt: dateOf(startsAt) ?? null }),
      ...(endsAt === undefined ? {} : { endsAt: dateOf(endsAt) ?? null }),
    };
  }

  /** An approved creative is never a medicine (code floor; the database has the same CHECK). */
  private assertFloor(status: string | undefined, category: string | undefined): void {
    if (status === "approved" && category !== undefined && isMedicineCategory(category)) {
      throw validationFailed("category");
    }
  }

  private assertSchedule(
    startsAt: string | null | undefined,
    endsAt: string | null | undefined,
  ): void {
    if (startsAt && endsAt && new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
      throw validationFailed("endsAt");
    }
  }

  /** The image must exist, be fully processed and be a format Telegram shows as a photo. */
  private async assertImage(mediaId: string): Promise<void> {
    const media = await this.repo.media(mediaId);
    if (media === null || media.status !== "ready" || !MEDIA_TYPES.has(media.mime ?? "")) {
      throw validationFailed("imageMediaId");
    }
  }

  // --- analytics --------------------------------------------------------------------------------

  private filterOf(query: StatsQuery) {
    const days = (Date.parse(query.to) - Date.parse(query.from)) / DAY_MS;
    if (!Number.isFinite(days) || days < 0 || days >= MAX_RANGE_DAYS) throw validationFailed("to");
    return {
      from: query.from,
      to: query.to,
      campaignId: query.campaignId,
      creativeId: query.creativeId,
    };
  }

  async stats(query: StatsQuery): Promise<TelegramAdStats> {
    const filter = this.filterOf(query);
    const rows = await this.repo.stats(filter);
    return {
      from: query.from,
      to: query.to,
      totals: withRates(rows.totals),
      byDay: rows.byDay.map((row) => withRates(row)),
      byCampaign: rows.byCampaign.map((row) => withRates(row)),
      byCreative: rows.byCreative.map((row) => withRates(row)),
      byTrigger: rows.byTrigger.flatMap((row) =>
        isTelegramAdTrigger(row.trigger) ? [withRates({ ...row, trigger: row.trigger })] : [],
      ),
    };
  }

  /** One row per Cairo day x creative. */
  async statsCsv(query: StatsQuery): Promise<string[]> {
    const rows = await this.repo.statsByDayCreative(this.filterOf(query));
    return [
      csvRow([
        "day",
        "campaign",
        "creative",
        "impressions",
        "clicks",
        "reactions",
        "hides",
        "reach",
        "ctr",
        "engagement_rate",
      ]),
      ...rows.map((row) => {
        const full = withRates(row);
        return csvRow([
          full.day,
          full.campaign,
          full.name,
          full.impressions,
          full.clicks,
          full.reactions,
          full.hides,
          full.reach,
          full.ctr.toFixed(4),
          full.engagementRate.toFixed(4),
        ]);
      }),
    ];
  }
}
