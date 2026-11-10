import { createHash, randomInt } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { type TelegramAdTrigger, type TelegramAdsSettings } from "@wasfa/shared/telegram-ads";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { AdsService } from "../ads/ads.service.js";
import { LocalCache } from "../common/local-cache.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { loadTelegramAdImage } from "./telegram-ad-image.js";
import {
  EMPTY_KEYBOARD,
  adText,
  markReacted,
  renderTelegramAd,
  type RenderedAd,
} from "./telegram-ad-render.js";
import { signTelegramAdToken, verifyTelegramAdToken } from "./telegram-ad-token.js";
import {
  avoidRepeat,
  campaignExhausted,
  eligibleCandidates,
  limitGate,
  passesProbability,
  preGate,
  weightedPick,
  type Rng,
  type TelegramAdCampaignCounts,
} from "./telegram-ads-selection.js";
import { TelegramAdsRepo } from "./telegram-ads.repo.js";
import { TelegramApiError, type TelegramApi } from "./telegram-api.client.js";
import { parseCallback } from "./telegram-keyboards.js";
import { TelegramRepo } from "./telegram.repo.js";

import type { BotLocale, InlineButton } from "./telegram-types.js";
import type { ApiEnv } from "../config/env.js";
import type { TelegramAdCandidate, TelegramAdCreativeRow } from "@wasfa/db";

const SNAPSHOT_TTL_MS = 15_000;
const DAY_SECONDS = 24 * 60 * 60;
const CHAT_DAY_TTL = 2 * DAY_SECONDS;
const CHAT_WEEK_TTL = 8 * DAY_SECONDS;
const GLOBAL_TTL = 2 * DAY_SECONDS;
const LAST_TTL = 7 * DAY_SECONDS;
const CLICK_DEDUP_SECONDS = 60;
const STATS_TZ = "Africa/Cairo";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const secureRng: Rng = () => randomInt(0, 2 ** 31) / 2 ** 31;

/** The Cairo calendar day (`YYYY-MM-DD`), the minutes since its midnight and the Monday that starts its week. */
function cairoClock(now: Date): { day: string; week: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STATS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const date = new Date(`${day}T00:00:00Z`);
  // Monday-based week: shift back to the Monday of this one.
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return {
    day,
    week: date.toISOString().slice(0, 10),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export interface TelegramAdCallbackInput {
  chatId: number;
  locale: BotLocale;
  queryId: string;
  messageId: number | undefined;
  data: string;
  /** The buttons currently under the pressed message. */
  rows: readonly (readonly InlineButton[])[] | undefined;
}

/**
 * The Telegram ads delivery engine (docs/TELEGRAM-BOT.md, "Ads"): INDEPENDENT of the web/WhatsApp ads,
 * with its own settings (`telegramAds`), campaigns, creatives, Redis counters (`ads:tg:*`) and event
 * log. One ad per call at most, as a separate message after the reply. The only floor that is not a
 * setting: never medicine, never an ad-free plan, never a chat that hid ads. Every failure is
 * swallowed and logged by error name: an ad must never break a reply.
 */
@Injectable()
export class TelegramAdsService {
  private readonly cache = new LocalCache<TelegramAdCandidate[]>(SNAPSHOT_TTL_MS);
  /** Injectable for tests (seeded); production uses the CSPRNG. */
  rng: Rng = secureRng;

  constructor(
    private readonly repo: TelegramAdsRepo,
    private readonly chats: TelegramRepo,
    private readonly ads: AdsService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV)
    private readonly env: Pick<ApiEnv, "BETTER_AUTH_SECRET" | "MEDIA_PUBLIC_ORIGIN" | "WEB_ORIGIN">,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("TelegramAds");
  }

  /** Drops the candidate snapshot (an admin changed a campaign or creative). */
  invalidate(): void {
    this.cache.clear();
  }

  async sendAfterDelivery(
    api: TelegramApi,
    chat: { chatId: number; userId: string | null },
    locale: BotLocale,
    trigger: TelegramAdTrigger = "after_rx_done",
    now: Date = new Date(),
  ): Promise<void> {
    try {
      await this.deliver(api, chat, locale, trigger, now);
    } catch (error) {
      if (error instanceof TelegramApiError && error.isBlocked) {
        await this.chats.patchChat(chat.chatId, { blocked: true }).catch(() => undefined);
        return;
      }
      this.logger.warn(
        { error: error instanceof Error ? error.name : "unknown" },
        "Telegram ad skipped",
      );
    }
  }

  private async deliver(
    api: TelegramApi,
    chat: { chatId: number; userId: string | null },
    locale: BotLocale,
    trigger: TelegramAdTrigger,
    now: Date,
  ): Promise<void> {
    const settings = await this.settings.get("telegramAds");
    const facts = await this.repo.chatFacts(chat.chatId);
    if (facts === null) return;
    const subject = {
      locale,
      linked: chat.userId !== null,
      adsHidden: facts.adsHidden,
    };
    // Cheap gates first; the plan lookup only for a chat that could still get an ad.
    if (preGate({ settings, trigger, chat: subject, adsFree: false, now }) !== null) return;
    if (await this.ads.isAdsFree(chat.userId)) return;

    const clock = cairoClock(now);
    const keys = this.keys(chat.chatId, clock);
    const counters = await this.counters(keys);
    if (limitGate(settings, counters) !== null) return;
    if (!passesProbability(settings, this.rng)) return;

    const candidates = await this.candidates();
    if (candidates.length === 0) return;
    const since = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - clock.minutes * 60_000);
    const counts = await this.repo.impressionCounts(
      candidates
        .filter(
          ({ campaign }) => campaign.dailyImpressionCap !== null || campaign.totalImpressionCap !== null,
        )
        .map(({ campaign }) => campaign.id),
      since,
    );
    this.endExhausted(candidates, counts);

    const eligible = eligibleCandidates({ candidates, counts, chat: subject, trigger, now });
    const last = await this.redis.get(keys.last);
    const picked = weightedPick(avoidRepeat(eligible, last), this.rng);
    if (picked === null) return;

    await this.send(api, chat.chatId, picked, { locale, trigger, settings, now, tracked: true });

    // Counters and the impression are recorded only after the message went out.
    await this.record(keys, settings, picked, chat.chatId, trigger).catch((error: unknown) => {
      this.logger.warn(
        { error: error instanceof Error ? error.name : "unknown" },
        "Telegram ad not recorded",
      );
    });
  }

  /**
   * Renders and sends one creative. `tracked` links carry the signed click token; a test send uses the
   * plain URLs so previews never count as clicks. A hero whose image is missing, cannot be loaded or
   * is refused by Telegram goes out as a card.
   */
  async send(
    api: TelegramApi,
    chatId: number,
    candidate: { creative: TelegramAdCreativeRow; media: TelegramAdCandidate["media"] },
    options: {
      locale: BotLocale;
      trigger: TelegramAdTrigger;
      settings: TelegramAdsSettings;
      now: Date;
      tracked: boolean;
    },
  ): Promise<void> {
    const { creative } = candidate;
    const image =
      creative.layout === "hero"
        ? await loadTelegramAdImage(candidate.media, this.env.MEDIA_PUBLIC_ORIGIN)
        : null;
    const origin = (this.env.WEB_ORIGIN[0] ?? "").replace(/\/$/, "");
    const links = creative.buttons.map((button, index) =>
      options.tracked
        ? `${origin}/t/${signTelegramAdToken(
            this.env.BETTER_AUTH_SECRET,
            { creativeId: creative.id, chatId, trigger: options.trigger, button: index },
            options.now,
          )}?b=${String(index)}`
        : button.url,
    );
    const render = (hasImage: boolean): RenderedAd =>
      renderTelegramAd(creative, {
        creativeId: creative.id,
        locale: options.locale,
        hasImage,
        links,
        allowHide: options.settings.allowHide,
        allowReactions: options.settings.allowReactions,
      });
    const sendCard = (rendered: RenderedAd) =>
      api.sendMessage(chatId, rendered.text, { replyMarkup: rendered.keyboard });

    const rendered = render(image !== null);
    if (rendered.kind === "photo" && image !== null) {
      try {
        await api.sendPhoto(chatId, image, {
          caption: rendered.text,
          replyMarkup: rendered.keyboard,
        });
      } catch (error) {
        // A refused image (not a blocked chat) still deserves its ad, as a card.
        if (error instanceof TelegramApiError && error.isBlocked) throw error;
        await sendCard(render(false));
      }
      return;
    }
    await sendCard(rendered);
  }

  private keys(chatId: number, clock: { day: string; week: string }) {
    const chat = String(chatId);
    return {
      chatDay: `ads:tg:chat:${chat}:d:${clock.day}`,
      chatWeek: `ads:tg:chat:${chat}:w:${clock.week}`,
      gap: `ads:tg:gap:${chat}`,
      global: `ads:tg:global:${clock.day}`,
      last: `ads:tg:last:${chat}`,
    };
  }

  private async counters(keys: ReturnType<TelegramAdsService["keys"]>) {
    const [values, gap] = await Promise.all([
      this.redis.mget(keys.chatDay, keys.chatWeek, keys.global),
      this.redis.exists(keys.gap),
    ]);
    return {
      chatToday: Number(values[0] ?? 0),
      chatThisWeek: Number(values[1] ?? 0),
      gapActive: gap > 0,
      globalToday: Number(values[2] ?? 0),
    };
  }

  private async record(
    keys: ReturnType<TelegramAdsService["keys"]>,
    settings: TelegramAdsSettings,
    picked: TelegramAdCandidate,
    chatId: number,
    trigger: TelegramAdTrigger,
  ): Promise<void> {
    const pipeline = this.redis
      .pipeline()
      .incr(keys.chatDay)
      .expire(keys.chatDay, CHAT_DAY_TTL)
      .incr(keys.chatWeek)
      .expire(keys.chatWeek, CHAT_WEEK_TTL)
      .incr(keys.global)
      .expire(keys.global, GLOBAL_TTL)
      .set(keys.last, picked.creative.id, "EX", LAST_TTL);
    if (settings.minGapMinutes.enabled && settings.minGapMinutes.value > 0) {
      pipeline.set(keys.gap, "1", "EX", Math.ceil(settings.minGapMinutes.value * 60));
    }
    await pipeline.exec();
    await this.repo.recordEvent({
      kind: "impression",
      creativeId: picked.creative.id,
      campaignId: picked.campaign.id,
      chatId,
      trigger,
    });
  }

  private async candidates(): Promise<TelegramAdCandidate[]> {
    const cached = this.cache.get("all");
    if (cached) return cached;
    const rows = await this.repo.candidates();
    this.cache.set("all", rows);
    return rows;
  }

  /** A campaign whose total budget is used up is marked ended (fire and forget). */
  private endExhausted(
    candidates: readonly TelegramAdCandidate[],
    counts: ReadonlyMap<string, TelegramAdCampaignCounts>,
  ): void {
    const done = new Set<string>();
    for (const { campaign } of candidates) {
      const seen = counts.get(campaign.id);
      if (seen && !done.has(campaign.id) && campaignExhausted(campaign, seen)) {
        done.add(campaign.id);
        void this.repo.endCampaign(campaign.id).catch(() => undefined);
      }
    }
    if (done.size > 0) this.cache.clear();
  }

  // --- callbacks ---------------------------------------------------------------------------------

  /** True when `data` is one of the ad buttons (`adr:`, `adh:`): the router must not answer it itself. */
  static isAdCallback(data: string): boolean {
    return data.startsWith("adr:") || data.startsWith("adh:");
  }

  /**
   * 👍 and "hide ads". Idempotent: a repeat press by the same chat on the same creative records
   * nothing new within a day. The callback is always answered (with the thanks text); an event is
   * written only for an ad that was really delivered (a test send has no impression).
   */
  async onCallback(api: TelegramApi, input: TelegramAdCallbackInput): Promise<void> {
    const { verb, arg } = parseCallback(input.data);
    const copy = adText(input.locale);
    const hide = verb === "adh";
    await api
      .answerCallbackQuery(input.queryId, hide ? copy.hidden : copy.thanks)
      .catch(() => undefined);
    if (!UUID.test(arg)) return;
    try {
      const campaignId = await this.repo.creativeCampaign(arg);
      if (campaignId !== null) {
        const trigger = await this.repo.lastImpressionTrigger(input.chatId, arg);
        const kind = hide ? "hide" : "reaction";
        const repeat = await this.repo.eventSince({
          chatId: input.chatId,
          creativeId: arg,
          kind,
          since: new Date(Date.now() - DAY_SECONDS * 1000),
        });
        if (trigger !== null && !repeat) {
          await this.repo.recordEvent({
            kind,
            creativeId: arg,
            campaignId,
            chatId: input.chatId,
            trigger,
          });
        }
      }
      if (hide) await this.repo.setAdsHidden(input.chatId, true);
      if (input.messageId === undefined) return;
      if (hide) {
        await api.editMessageReplyMarkup(input.chatId, input.messageId, EMPTY_KEYBOARD);
      } else if (input.rows !== undefined) {
        await api.editMessageReplyMarkup(
          input.chatId,
          input.messageId,
          markReacted(input.rows, input.locale),
        );
      }
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.name : "unknown" },
        "Telegram ad callback failed",
      );
    }
  }

  /** `/ads_on`: ads may reach this chat again. Returns whether anything changed. */
  async enableForChat(chatId: number): Promise<boolean> {
    const facts = await this.repo.chatFacts(chatId);
    if (facts === null || !facts.adsHidden) return false;
    await this.repo.setAdsHidden(chatId, false);
    return true;
  }

  // --- tracked clicks ------------------------------------------------------------------------------

  /**
   * The destination of a tracked button link, counting the click once per token per minute. A bad,
   * forged or expired token (or a creative or button that is gone) leads to the web origin.
   */
  async trackClick(token: string, now: Date = new Date()): Promise<string> {
    const fallback = this.env.WEB_ORIGIN[0] ?? "";
    const claims = verifyTelegramAdToken(this.env.BETTER_AUTH_SECRET, token, now);
    if (claims === null) return fallback;
    const target = await this.repo.buttonTarget(claims.creativeId);
    const url = target?.buttons[claims.button]?.url;
    if (target === null || url === undefined) return fallback;
    const digest = createHash("sha256").update(token).digest("hex").slice(0, 32);
    const first = await this.redis.set(`ads:tg:click:${digest}`, "1", "EX", CLICK_DEDUP_SECONDS, "NX");
    if (first === "OK") {
      await this.repo
        .recordEvent({
          kind: "click",
          creativeId: claims.creativeId,
          campaignId: target.campaignId,
          chatId: claims.chatId,
          trigger: claims.trigger,
        })
        .catch(() => undefined);
    }
    return url;
  }
}
