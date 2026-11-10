import { z } from "zod";

/*
 * The Telegram ads system: its own campaigns, creatives, settings, tracking and analytics, apart from
 * the web/WhatsApp ads (`ads.ts`). Every delivery LIMIT is the admin's: each one is a switch plus a
 * number, and switched off means "no limit". The only floor that stays is the safety one in code:
 * no medicine ads, never to an ad-free plan.
 */

/** Where in the bot an ad may appear. */
export const TELEGRAM_AD_TRIGGERS = [
  "after_rx_done", // right after an analysis result
  "after_followup", // after an AI answer to a free-text question
  "after_pdf", // after the PDF was sent
  "after_history", // after /history or /last
  "after_balance", // after /balance
  "on_start", // after the /start welcome
  "on_new_chat", // after "new chat"
] as const;
export type TelegramAdTrigger = (typeof TELEGRAM_AD_TRIGGERS)[number];

/** How a creative is laid out: image on top with caption (hero), text only (card), one short line (compact). */
export const TELEGRAM_AD_LAYOUTS = ["hero", "card", "compact"] as const;
export type TelegramAdLayout = (typeof TELEGRAM_AD_LAYOUTS)[number];

export const TELEGRAM_AD_STATUSES = ["draft", "approved", "paused", "archived"] as const;
export const TELEGRAM_CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"] as const;
export const TELEGRAM_AD_AUDIENCES = ["all", "linked", "unlinked"] as const;
export const TELEGRAM_AD_EVENT_KINDS = ["impression", "click", "reaction", "hide"] as const;
export type TelegramAdEventKind = (typeof TELEGRAM_AD_EVENT_KINDS)[number];

/** Telegram caption limit with an image; a text-only message may be longer but ads stay short. */
export const TELEGRAM_AD_BODY_MAX = 700;
export const TELEGRAM_AD_HEADLINE_MAX = 100;
export const TELEGRAM_AD_BUTTONS_MAX = 4;

const BIG = 1_000_000_000;

/** One limit: `enabled: false` means unlimited, whatever `value` holds. */
const limit = (min: number, max: number, value: number) =>
  z.object({
    enabled: z.boolean().default(false),
    value: z.number().min(min).max(max).default(value),
  });

export const telegramAdsSettingsSchema = z.object({
  /** Master switch of Telegram ads. */
  enabled: z.boolean().default(true),
  /** Chance that an eligible moment shows an ad (0-1). Off = every eligible moment shows one. */
  probability: limit(0, 1, 0.7).default({ enabled: true, value: 0.7 }),
  /** Ads one chat may receive per day. Off = no cap. */
  maxPerChatPerDay: limit(1, BIG, 3).default({ enabled: true, value: 3 }),
  /** Ads one chat may receive per week. Off = no cap. */
  maxPerChatPerWeek: limit(1, BIG, 10).default({ enabled: false, value: 10 }),
  /** Minimum minutes between two ads to the same chat. Off = no gap. */
  minGapMinutes: limit(0, 100_000, 30).default({ enabled: true, value: 30 }),
  /** All Telegram ads per day, across chats. Off = no cap. */
  globalDailyLimit: limit(1, BIG, 5_000).default({ enabled: false, value: 5_000 }),
  /** Quiet hours (local time of `timezone`): no ads inside. Off = ads at any hour. */
  quietHours: z
    .object({
      enabled: z.boolean().default(false),
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("23:00"),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("08:00"),
      timezone: z.string().min(1).max(64).default("Africa/Cairo"),
    })
    .default({ enabled: false, start: "23:00", end: "08:00", timezone: "Africa/Cairo" }),
  /** Moments that may show an ad. Empty = none. */
  triggers: z.array(z.enum(TELEGRAM_AD_TRIGGERS)).max(TELEGRAM_AD_TRIGGERS.length).default([
    "after_rx_done",
    "after_followup",
  ]),
  /** Show a "hide ads" button on every ad and honour it per chat. */
  allowHide: z.boolean().default(true),
  /** Show the 👍 interest button (engagement analytics). */
  allowReactions: z.boolean().default(true),
});
export type TelegramAdsSettings = z.output<typeof telegramAdsSettingsSchema>;

export const telegramAdButtonSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: z.string().trim().url().max(2_000).refine((value) => /^https:\/\//.test(value)),
});
export type TelegramAdButton = z.infer<typeof telegramAdButtonSchema>;

export const telegramAdTargetingSchema = z.object({
  /** Empty = any language. */
  locales: z.array(z.enum(["ar", "en"])).max(2).default([]),
  audience: z.enum(TELEGRAM_AD_AUDIENCES).default("all"),
  /** Empty = every enabled trigger. */
  triggers: z.array(z.enum(TELEGRAM_AD_TRIGGERS)).default([]),
});
export type TelegramAdTargeting = z.output<typeof telegramAdTargetingSchema>;
