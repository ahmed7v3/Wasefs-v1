import { Inject, Injectable } from "@nestjs/common";
import {
  ADS_STATS_MAX_DAYS,
  SERVABLE_PAGE_CLASSES,
  isForbiddenCategory,
  neverServeClassesIn,
  parseAdSize,
  type AdChannel,
  type AdStatsQuery,
  type AdStatus,
  type AdminAdStats,
  type AdminAdvertiser,
  type AdminCreative,
  type AdminPlacement,
  type AdsSettings,
  type CreateCreativeInput,
  type PageClass,
  type UpdateAdsSettingsInput,
  type UpdateAdvertiserInput,
  type UpdateCreativeInput,
  type UpdatePlacementInput,
  type AdvertiserInput,
} from "@wasfa/shared/ads";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { type AuditScope } from "../audit/audited.decorator.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService, type SettingWriteContext } from "../settings/settings.service.js";

import { AdminAdsRepo, type CreativeAdminRow, type PlacementPatch } from "./admin-ads.repo.js";
import { pickAdImage } from "./ads-image.js";
import { aggregateAdStats } from "./ads-stats.js";
import { utcDay } from "./ads-token.js";

import type { ApiEnv } from "../config/env.js";
import type { AdCreativeRow, AdPlacementRow, AdvertiserRow } from "@wasfa/db";

const BOTTOM_BANNER_KEY = "global.bottom_banner";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 7;
const PREVIEW_WIDTH = 640;
/** WhatsApp stat keys (`whatsapp.<trigger>`) are counters of the WhatsApp runtime, not web placements. */
const isWebPlacement = (key: string) => !key.startsWith("whatsapp.");

type ServableClass = AdsSettings["bottomBanner"]["pageClasses"][number];
const servableOnly = (classes: readonly PageClass[]): ServableClass[] =>
  classes.filter((pageClass): pageClass is ServableClass =>
    (SERVABLE_PAGE_CLASSES as readonly PageClass[]).includes(pageClass),
  );

function validationFailed(...fields: string[]): AppError {
  return new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields } });
}

/**
 * The console behind `/admin/ads` (docs/ADS.md §6). The safety floor is enforced here as well as
 * at delivery: a never-serve class is refused with a typed error, a medicine creative can never be
 * approved, and every write fills the audit scope (or goes through `SettingsService`, which audits).
 */
@Injectable()
export class AdminAdsService {
  constructor(
    private readonly repo: AdminAdsRepo,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: Pick<ApiEnv, "MEDIA_PUBLIC_ORIGIN">,
  ) {}

  // --- global switches --------------------------------------------------------------------

  getSettings(): Promise<AdsSettings> {
    return this.settings.get("ads");
  }

  async updateSettings(
    input: UpdateAdsSettingsInput,
    ctx: SettingWriteContext,
  ): Promise<AdsSettings> {
    const current = await this.settings.get("ads");
    const next = {
      ...current,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.maxPerPage === undefined
        ? {}
        : { maxPerPage: { ...current.maxPerPage, ...input.maxPerPage } }),
      ...(input.whatsapp === undefined ? {} : { whatsapp: input.whatsapp }),
    };
    // `SettingsService.set` validates, drops the caches on every instance and writes the audit row.
    return this.settings.set("ads", next, ctx);
  }

  // --- placements -------------------------------------------------------------------------

  private toPlacement(row: AdPlacementRow, settings: AdsSettings): AdminPlacement {
    const banner = row.key === BOTTOM_BANNER_KEY;
    return {
      key: row.key,
      // The bottom banner is switched, scoped and timed by the `ads` setting; the row holds the rest.
      enabled: banner ? row.enabled && settings.bottomBanner.enabled : row.enabled,
      pageClasses: banner ? [...settings.bottomBanner.pageClasses] : row.pageClasses,
      devices: row.devices,
      maxPerPage: row.maxPerPage,
      format: row.format,
      sizeDesktop: row.sizeDesktop,
      sizeMobile: row.sizeMobile,
      closable: banner ? true : row.closable,
      dismissDays: banner ? settings.bottomBanner.dismissDays : row.dismissDays,
      allowPaid: row.allowPaid,
      sort: row.sort,
    };
  }

  async listPlacements(): Promise<{ items: AdminPlacement[] }> {
    const [rows, settings] = await Promise.all([this.repo.placements(), this.settings.get("ads")]);
    return {
      items: rows
        .filter((row) => isWebPlacement(row.key))
        .map((row) => this.toPlacement(row, settings)),
    };
  }

  async updatePlacement(
    key: string,
    input: UpdatePlacementInput,
    audit: AuditScope,
    ctx: SettingWriteContext,
  ): Promise<AdminPlacement> {
    const row = isWebPlacement(key) ? await this.repo.placement(key) : null;
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);

    // The floor is code: no admin value reaches a never-serve class.
    const blocked = neverServeClassesIn(input.pageClasses ?? []);
    if (blocked.length > 0) {
      throw new AppError(ErrorCode.AD_CLASS_NOT_SERVABLE, { details: { classes: blocked } });
    }
    if (input.sizeDesktop !== undefined) this.assertSize(row, input.sizeDesktop, "sizeDesktop");
    if (input.sizeMobile !== undefined) this.assertSize(row, input.sizeMobile, "sizeMobile");

    const settings = await this.settings.get("ads");
    const before = this.toPlacement(row, settings);
    const patch: PlacementPatch = {
      ...(input.devices === undefined ? {} : { devices: input.devices }),
      ...(input.maxPerPage === undefined ? {} : { maxPerPage: input.maxPerPage }),
      ...(input.sizeDesktop === undefined ? {} : { sizeDesktop: input.sizeDesktop }),
      ...(input.sizeMobile === undefined ? {} : { sizeMobile: input.sizeMobile }),
      ...(input.allowPaid === undefined ? {} : { allowPaid: input.allowPaid }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };

    if (key === BOTTOM_BANNER_KEY) {
      await this.updateBottomBanner(settings, input, ctx);
    } else {
      if (input.pageClasses !== undefined) patch.pageClasses = input.pageClasses;
      if (input.closable !== undefined) patch.closable = input.closable;
      if (input.dismissDays !== undefined) patch.dismissDays = input.dismissDays;
    }

    const updated =
      Object.keys(patch).length > 0 ? await this.repo.updatePlacement(key, patch) : row;
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND);
    const after = this.toPlacement(updated, await this.settings.get("ads"));
    audit.targetId = key;
    audit.before = before;
    audit.after = after;
    return after;
  }

  /** The banner's switch, classes and dismiss period live in the `ads` setting (one source for web and api). */
  private async updateBottomBanner(
    settings: AdsSettings,
    input: UpdatePlacementInput,
    ctx: SettingWriteContext,
  ): Promise<void> {
    if (
      input.enabled === undefined &&
      input.pageClasses === undefined &&
      input.dismissDays === undefined
    ) {
      return;
    }
    const bottomBanner = {
      enabled: input.enabled ?? settings.bottomBanner.enabled,
      pageClasses: input.pageClasses
        ? servableOnly(input.pageClasses)
        : settings.bottomBanner.pageClasses,
      dismissDays: input.dismissDays ?? settings.bottomBanner.dismissDays,
    };
    await this.settings.set("ads", { ...settings, bottomBanner }, ctx);
  }

  /** A banner needs a `WxH` box; only a native card may be `native` (the box is reserved from it). */
  private assertSize(row: AdPlacementRow, size: string, field: string): void {
    if (row.format !== "native" && parseAdSize(size) === null) throw validationFailed(field);
  }

  // --- advertisers ------------------------------------------------------------------------

  private toAdvertiser(row: AdvertiserRow, creativeCount: number): AdminAdvertiser {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      contact: row.contact,
      active: row.active,
      creativeCount,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listAdvertisers(): Promise<{ items: AdminAdvertiser[] }> {
    const rows = await this.repo.advertisers();
    return { items: rows.map((row) => this.toAdvertiser(row.advertiser, row.creativeCount)) };
  }

  async createAdvertiser(input: AdvertiserInput, audit: AuditScope): Promise<AdminAdvertiser> {
    const row = await this.repo.createAdvertiser(input);
    const view = this.toAdvertiser(row, 0);
    audit.targetId = row.id;
    audit.after = view;
    return view;
  }

  async updateAdvertiser(
    id: string,
    input: UpdateAdvertiserInput,
    audit: AuditScope,
  ): Promise<AdminAdvertiser> {
    const before = await this.repo.advertiser(id);
    if (!before) throw new AppError(ErrorCode.NOT_FOUND);
    const row = await this.repo.updateAdvertiser(id, {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.contact === undefined ? {} : { contact: input.contact }),
      ...(input.active === undefined ? {} : { active: input.active }),
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const count = await this.repo.creativeCountOf(id);
    audit.targetId = id;
    audit.before = this.toAdvertiser(before, count);
    audit.after = this.toAdvertiser(row, count);
    return this.toAdvertiser(row, count);
  }

  /** An advertiser with creatives is deactivated, never deleted: its stats and creatives stay readable. */
  async deleteAdvertiser(id: string, audit: AuditScope): Promise<void> {
    const row = await this.repo.advertiser(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const count = await this.repo.creativeCountOf(id);
    if (count > 0) throw new AppError(ErrorCode.CONFLICT, { details: { creativeCount: count } });
    await this.repo.deleteAdvertiser(id);
    audit.targetId = id;
    audit.before = this.toAdvertiser(row, 0);
  }

  // --- creatives --------------------------------------------------------------------------

  private toCreative(entry: CreativeAdminRow): AdminCreative {
    const { creative } = entry;
    return {
      id: creative.id,
      advertiserId: creative.advertiserId,
      advertiserName: entry.advertiserName,
      title: creative.title,
      imageMediaId: creative.imageMediaId,
      imageUrl: pickAdImage(entry.media, PREVIEW_WIDTH, this.env.MEDIA_PUBLIC_ORIGIN)?.url ?? null,
      alt: creative.alt,
      targetUrl: creative.targetUrl,
      category: creative.category,
      status: creative.status,
      startsAt: creative.startsAt?.toISOString() ?? null,
      endsAt: creative.endsAt?.toISOString() ?? null,
      weight: creative.weight,
      targeting: creative.targeting,
      channels: creative.channels,
      waText: creative.waText,
      createdAt: creative.createdAt.toISOString(),
      updatedAt: creative.updatedAt.toISOString(),
    };
  }

  async listCreatives(filter: {
    status?: AdStatus | undefined;
    channel?: AdChannel | undefined;
  }): Promise<{ items: AdminCreative[] }> {
    const rows = await this.repo.creatives(filter);
    return { items: rows.map((row) => this.toCreative(row)) };
  }

  private async loadCreative(id: string): Promise<CreativeAdminRow> {
    const row = await this.repo.creative(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return row;
  }

  async getCreative(id: string): Promise<AdminCreative> {
    return this.toCreative(await this.loadCreative(id));
  }

  /** References must exist, the image must be ready, a WhatsApp ad needs its text, the schedule must be ordered. */
  private async assertCreativeState(
    state: {
      advertiserId: string | null;
      imageMediaId: string | null;
      channels: readonly AdChannel[];
      waText: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
    },
    changed: { advertiserId: boolean; imageMediaId: boolean },
  ): Promise<void> {
    if (
      state.channels.includes("whatsapp") &&
      (state.waText === null || state.waText.trim() === "")
    ) {
      throw validationFailed("waText");
    }
    if (state.startsAt && state.endsAt && state.startsAt.getTime() >= state.endsAt.getTime()) {
      throw validationFailed("endsAt");
    }
    if (changed.advertiserId && state.advertiserId !== null) {
      if (!(await this.repo.advertiser(state.advertiserId))) throw validationFailed("advertiserId");
    }
    if (changed.imageMediaId && state.imageMediaId !== null) {
      if (!(await this.repo.mediaIsReady(state.imageMediaId)))
        throw validationFailed("imageMediaId");
    }
  }

  async createCreative(input: CreateCreativeInput, audit: AuditScope): Promise<AdminCreative> {
    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    await this.assertCreativeState(
      { ...input, startsAt, endsAt },
      { advertiserId: true, imageMediaId: true },
    );
    // Always a draft: approval is its own action and runs the category check.
    const id = await this.repo.createCreative({
      advertiserId: input.advertiserId,
      title: input.title,
      imageMediaId: input.imageMediaId,
      alt: input.alt,
      targetUrl: input.targetUrl,
      category: input.category,
      status: "draft",
      startsAt,
      endsAt,
      weight: input.weight,
      targeting: input.targeting,
      channels: input.channels,
      waText: input.waText,
    });
    const view = await this.getCreative(id);
    audit.targetId = id;
    audit.after = view;
    return view;
  }

  async updateCreative(
    id: string,
    input: UpdateCreativeInput,
    audit: AuditScope,
  ): Promise<AdminCreative> {
    const current = await this.loadCreative(id);
    const before = this.toCreative(current);
    const merged: AdCreativeRow = {
      ...current.creative,
      ...(input.advertiserId === undefined ? {} : { advertiserId: input.advertiserId }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.imageMediaId === undefined ? {} : { imageMediaId: input.imageMediaId }),
      ...(input.alt === undefined ? {} : { alt: input.alt }),
      ...(input.targetUrl === undefined ? {} : { targetUrl: input.targetUrl }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.channels === undefined ? {} : { channels: input.channels }),
      ...(input.waText === undefined ? {} : { waText: input.waText }),
      ...(input.startsAt === undefined
        ? {}
        : { startsAt: input.startsAt ? new Date(input.startsAt) : null }),
      ...(input.endsAt === undefined
        ? {}
        : { endsAt: input.endsAt ? new Date(input.endsAt) : null }),
      ...(input.weight === undefined ? {} : { weight: input.weight }),
      ...(input.targeting === undefined ? {} : { targeting: input.targeting }),
    };
    // A live creative cannot be turned into a medicine by an edit either.
    if (merged.status === "approved" && isForbiddenCategory(merged.category)) {
      throw new AppError(ErrorCode.AD_CATEGORY_FORBIDDEN);
    }
    await this.assertCreativeState(merged, {
      advertiserId: input.advertiserId !== undefined,
      imageMediaId: input.imageMediaId !== undefined,
    });
    await this.repo.updateCreative(id, {
      advertiserId: merged.advertiserId,
      title: merged.title,
      imageMediaId: merged.imageMediaId,
      alt: merged.alt,
      targetUrl: merged.targetUrl,
      category: merged.category,
      startsAt: merged.startsAt,
      endsAt: merged.endsAt,
      weight: merged.weight,
      targeting: merged.targeting,
      channels: merged.channels,
      waText: merged.waText,
    });
    const view = await this.getCreative(id);
    audit.targetId = id;
    audit.before = before;
    audit.after = view;
    return view;
  }

  /** draft / approved / paused / archived. Approval is refused for the medicine category (ADS §1.3). */
  async setCreativeStatus(id: string, status: AdStatus, audit: AuditScope): Promise<AdminCreative> {
    const current = await this.loadCreative(id);
    if (status === "approved" && isForbiddenCategory(current.creative.category)) {
      throw new AppError(ErrorCode.AD_CATEGORY_FORBIDDEN, {
        details: { category: current.creative.category },
      });
    }
    await this.repo.updateCreative(id, { status });
    audit.targetId = id;
    audit.before = { status: current.creative.status };
    audit.after = { status };
    return this.getCreative(id);
  }

  /** Only a draft is deleted; a creative that ever ran is archived so its numbers stay. */
  async deleteCreative(id: string, audit: AuditScope): Promise<void> {
    const current = await this.loadCreative(id);
    if (current.creative.status !== "draft") {
      throw new AppError(ErrorCode.CONFLICT, { details: { status: current.creative.status } });
    }
    await this.repo.deleteCreative(id);
    audit.targetId = id;
    audit.before = this.toCreative(current);
  }

  // --- statistics -------------------------------------------------------------------------

  /** UTC days, inclusive. Default: the last 7 days ending today; at most a year. */
  async stats(query: AdStatsQuery, now = new Date()): Promise<AdminAdStats> {
    const to = query.to ?? utcDay(now);
    const from = query.from ?? utcDay(new Date(Date.parse(to) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS));
    const days = (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
    if (!(days >= 1) || days > ADS_STATS_MAX_DAYS) throw validationFailed("from", "to");
    const channel = query.channel ?? null;
    const rows = await this.repo.statsRows({ from, to, channel });
    return aggregateAdStats(rows, { from, to, channel });
  }
}
