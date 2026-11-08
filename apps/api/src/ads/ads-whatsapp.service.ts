import { randomInt } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  AD_LABEL_KEY,
  adCounterKey,
  whatsappPlacementKey,
  type AdWhatsappTrigger,
} from "@wasfa/shared/ads";
import { t, type Locale } from "@wasfa/shared/i18n";
import { Redis } from "ioredis";

import { LocalCache } from "../common/local-cache.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";
import { WaAgentStateService } from "../wa-agent/wa-agent-state.service.js";

import { selectWhatsAppCreative, type Rng } from "./ads-selection.js";
import { WA_AD_TOKEN_TTL_SECONDS, signAdToken, utcDay } from "./ads-token.js";
import { AdsRepo, type CreativeCandidateRow } from "./ads.repo.js";
import { AdsService } from "./ads.service.js";

import type { ApiEnv } from "../config/env.js";
import type { WaConversation } from "@wasfa/db";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";

const SNAPSHOT_TTL_MS = 15_000;
const DAY_SECONDS = 24 * 60 * 60;
/** Per-day cap keys outlive the Cairo day by a margin (the day key changes at local midnight). */
const CAP_TTL_SECONDS = 2 * DAY_SECONDS;
const COUNTER_TTL_SECONDS = 3 * DAY_SECONDS;
const IMAGE_WIDTH = 800;
const FALLBACK_TIMEZONE = "Africa/Cairo";

const secureRng: Rng = () => randomInt(0, 2 ** 31) / 2 ** 31;

/**
 * What the trigger's own message was. Only a delivered result (or later a delivered command answer)
 * may be followed by an ad: a failure, a payment or order message and the like never are.
 */
export type WhatsAppAdMoment = "delivered" | "failure" | "payment";

/**
 * Deliberately all there is: no message, prescription, analysis or medicine reaches this function,
 * so the choice of the ad cannot depend on any of them (spec ads/whatsapp-ads, medical floor).
 */
export interface WhatsAppAdContext {
  moment: WhatsAppAdMoment;
  locale?: Locale;
  now?: Date;
}

/** One ad ready to send, and the call that records it once it was queued. */
export interface WhatsAppAdOffer {
  /** Exactly one part: the ad is one message, after the trigger's own parts. */
  parts: WaAgentOutboundPart[];
  creativeId: string;
  /** Caps and the impression are recorded only here, after the part was queued successfully. */
  confirmSent: () => Promise<void>;
}

/** The Cairo (or admin-set) calendar day and minutes since local midnight of `now`. */
function localClock(now: Date, timeZone: string): { day: string; minutes: number } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return {
      day: `${get("year")}-${get("month")}-${get("day")}`,
      minutes: Number(get("hour")) * 60 + Number(get("minute")),
    };
  };
  try {
    return read(timeZone);
  } catch {
    return read(FALLBACK_TIMEZONE);
  }
}

function minutesOf(hhmm: string): number {
  const [hours = "0", minutes = "0"] = hhmm.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** `from`-`to` may wrap midnight (23:00-08:00); equal bounds mean no quiet hours. */
export function inQuietHours(minutes: number, from: string, to: string): boolean {
  const start = minutesOf(from);
  const end = minutesOf(to);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * Chooses the WhatsApp ad that may follow one trigger (D9). Deterministic, no model: switch, trigger,
 * the floor, quiet hours, the Redis caps, then the probability draw, then a weighted pick among the
 * creatives of the WhatsApp channel. Counters live in Redis; the rollup writes the statistics.
 */
@Injectable()
export class AdsWhatsappService {
  private readonly cache = new LocalCache<CreativeCandidateRow[]>(SNAPSHOT_TTL_MS);
  /** Injectable for tests (seeded); production uses the CSPRNG. */
  rng: Rng = secureRng;

  constructor(
    private readonly repo: AdsRepo,
    private readonly ads: AdsService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV)
    private readonly env: Pick<ApiEnv, "BETTER_AUTH_SECRET" | "MEDIA_PUBLIC_ORIGIN" | "WEB_ORIGIN">,
  ) {}

  async maybeWhatsAppAd(
    conversation: WaConversation,
    trigger: AdWhatsappTrigger,
    ctx: WhatsAppAdContext,
  ): Promise<WhatsAppAdOffer | null> {
    const now = ctx.now ?? new Date();
    const config = (await this.settings.get("ads")).whatsapp;
    if (!config.enabled) return null;
    if (!config.triggers.includes(trigger)) return null;

    // The floor. Whatever the admin set, none of these can be bypassed.
    if (ctx.moment !== "delivered") return null;
    if (WaAgentStateService.isHeld(conversation, now.getTime())) return null;
    if (conversation.adsOptOut) return null;
    if (await this.ads.isAdsFree(conversation.userId)) return null;

    const clock = localClock(now, config.quietHours.timezone);
    if (inQuietHours(clock.minutes, config.quietHours.from, config.quietHours.to)) return null;

    const userKey = `ads:wa:user:${conversation.id}:${clock.day}`;
    const gapKey = `ads:wa:gap:${conversation.id}`;
    const globalKey = `ads:wa:global:${clock.day}`;
    if (config.maxPerUserPerDay <= 0 || config.globalDailyLimit <= 0) return null;
    const [userCount, gap, globalCount] = await Promise.all([
      this.redis.get(userKey),
      config.minGapHours > 0 ? this.redis.exists(gapKey) : Promise.resolve(0),
      this.redis.get(globalKey),
    ]);
    if (Number(userCount ?? 0) >= config.maxPerUserPerDay) return null;
    if (gap > 0) return null;
    if (Number(globalCount ?? 0) >= config.globalDailyLimit) return null;

    if (this.rng() >= config.probability) return null;

    const candidates = await this.candidates();
    const creative = selectWhatsAppCreative(candidates, now, this.rng);
    const candidate = creative && candidates.find((entry) => entry.creative.id === creative.id);
    if (!creative || !candidate || creative.waText === null) return null;

    const placement = whatsappPlacementKey(trigger);
    const token = signAdToken(
      this.env.BETTER_AUTH_SECRET,
      { creativeId: creative.id, placement, day: utcDay(now), channel: "whatsapp" },
      now,
      WA_AD_TOKEN_TTL_SECONDS,
    );
    const origin = (this.env.WEB_ORIGIN[0] ?? "").replace(/\/$/, "");
    const body = [
      `«${t(AD_LABEL_KEY, {}, ctx.locale ?? "ar")}»`,
      creative.waText,
      `${origin}/a/${token}`,
    ].join("\n\n");
    const imageUrl = this.imageUrl(candidate);
    const part: WaAgentOutboundPart =
      imageUrl === null
        ? { kind: "text", text: body }
        : { kind: "image", url: imageUrl, caption: body };

    return {
      parts: [part],
      creativeId: creative.id,
      confirmSent: () =>
        this.record({
          userKey,
          gapKey,
          globalKey,
          gapSeconds: config.minGapHours * 3600,
          impressionKey: adCounterKey({
            creativeId: creative.id,
            placement,
            day: utcDay(now),
            channel: "whatsapp",
            kind: "i",
          }),
        }),
    };
  }

  private async candidates(): Promise<CreativeCandidateRow[]> {
    const cached = this.cache.get("all");
    if (cached) return cached;
    const rows = await this.repo.approvedCreatives();
    this.cache.set("all", rows);
    return rows;
  }

  /** A published JPEG (else WebP: WhatsApp does not show AVIF) at least 800 px wide, else the widest. */
  private imageUrl(candidate: CreativeCandidateRow): string | null {
    const origin = this.env.MEDIA_PUBLIC_ORIGIN;
    const media = candidate.media;
    if (!origin || !media || media.status !== "ready") return null;
    const byWidth = (a: { width: number }, b: { width: number }) => a.width - b.width;
    const of = (format: string) =>
      media.variants.filter((variant) => variant.format === format).sort(byWidth);
    const variants = [of("jpeg"), of("webp")].find((list) => list.length > 0) ?? [];
    const chosen = variants.find((variant) => variant.width >= IMAGE_WIDTH) ?? variants.at(-1);
    return chosen ? `${origin.replace(/\/$/, "")}/${chosen.key}` : null;
  }

  private async record(keys: {
    userKey: string;
    gapKey: string;
    globalKey: string;
    gapSeconds: number;
    impressionKey: string;
  }): Promise<void> {
    const pipeline = this.redis
      .pipeline()
      .incr(keys.userKey)
      .expire(keys.userKey, CAP_TTL_SECONDS)
      .incr(keys.globalKey)
      .expire(keys.globalKey, CAP_TTL_SECONDS)
      .incr(keys.impressionKey)
      .expire(keys.impressionKey, COUNTER_TTL_SECONDS);
    if (keys.gapSeconds > 0) pipeline.set(keys.gapKey, "1", "EX", keys.gapSeconds);
    await pipeline.exec();
  }
}
