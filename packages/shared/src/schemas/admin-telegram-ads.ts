import { z } from "zod";

import {
  TELEGRAM_AD_BODY_MAX,
  TELEGRAM_AD_BUTTONS_MAX,
  TELEGRAM_AD_HEADLINE_MAX,
  TELEGRAM_AD_LAYOUTS,
  TELEGRAM_AD_STATUSES,
  TELEGRAM_CAMPAIGN_STATUSES,
  TELEGRAM_AD_TRIGGERS,
  telegramAdButtonSchema,
  telegramAdTargetingSchema,
  telegramAdsSettingsSchema,
} from "../telegram-ads.js";

/*
 * Admin contract of the Telegram ads (`/admin/telegram/ads`). Permissions: `ads.read` for GET,
 * `ads.write` for writes (fresh auth 10 min, audited). Dates are ISO strings.
 */

const isoDate = z.string().datetime();

// ---- settings: GET/PUT admin/telegram/ads/settings ----
export const telegramAdsSettingsInputSchema = telegramAdsSettingsSchema;

// ---- campaigns: GET/POST admin/telegram/ads/campaigns, PATCH/DELETE .../campaigns/:id ----
export const telegramAdCampaignInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  advertiser: z.string().trim().max(120).default(""),
  status: z.enum(TELEGRAM_CAMPAIGN_STATUSES).default("draft"),
  startsAt: isoDate.nullable().default(null),
  endsAt: isoDate.nullable().default(null),
  /** Impressions per day for this campaign; null = unlimited. */
  dailyImpressionCap: z.number().int().min(1).max(1_000_000_000).nullable().default(null),
  /** Total impressions budget; null = unlimited. The campaign ends when it is used up. */
  totalImpressionCap: z.number().int().min(1).max(1_000_000_000).nullable().default(null),
  notes: z.string().trim().max(1_000).default(""),
});
export const telegramAdCampaignPatchSchema = telegramAdCampaignInputSchema.partial();

export const telegramAdCampaignSchema = telegramAdCampaignInputSchema.extend({
  id: z.string().uuid(),
  creativeCount: z.number().int(),
  impressions: z.number().int(),
  clicks: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type TelegramAdCampaign = z.infer<typeof telegramAdCampaignSchema>;
export const telegramAdCampaignListSchema = z.object({ items: z.array(telegramAdCampaignSchema) });

// ---- creatives: GET(?campaignId)/POST admin/telegram/ads/creatives, PATCH/DELETE .../creatives/:id ----
export const telegramAdCreativeInputSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  status: z.enum(TELEGRAM_AD_STATUSES).default("draft"),
  layout: z.enum(TELEGRAM_AD_LAYOUTS).default("hero"),
  headline: z.string().trim().min(1).max(TELEGRAM_AD_HEADLINE_MAX),
  body: z.string().trim().max(TELEGRAM_AD_BODY_MAX).default(""),
  /** `media_assets.id` of the uploaded image (hero layout needs one); null = text only. */
  imageMediaId: z.string().uuid().nullable().default(null),
  /** Link buttons under the ad (first = main call to action). */
  buttons: z.array(telegramAdButtonSchema).max(TELEGRAM_AD_BUTTONS_MAX).default([]),
  /** Buttons per row (1 or 2). */
  buttonsPerRow: z.union([z.literal(1), z.literal(2)]).default(1),
  /** Any category except medicine (the one floor that is code, not setting). */
  category: z.string().trim().min(1).max(60).default("general"),
  weight: z.number().int().min(1).max(1_000).default(100),
  startsAt: isoDate.nullable().default(null),
  endsAt: isoDate.nullable().default(null),
  targeting: telegramAdTargetingSchema.default({ locales: [], audience: "all", triggers: [] }),
});
export const telegramAdCreativePatchSchema = telegramAdCreativeInputSchema.partial();

export const telegramAdCreativeSchema = telegramAdCreativeInputSchema.extend({
  id: z.string().uuid(),
  /** Public URL of the image for the admin preview (null without an image). */
  imageUrl: z.string().nullable(),
  impressions: z.number().int(),
  clicks: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type TelegramAdCreative = z.infer<typeof telegramAdCreativeSchema>;
export const telegramAdCreativeListSchema = z.object({ items: z.array(telegramAdCreativeSchema) });

/** POST admin/telegram/ads/creatives/:id/status */
export const telegramAdStatusInputSchema = z.object({ status: z.enum(TELEGRAM_AD_STATUSES) });

/** POST admin/telegram/ads/creatives/:id/test-send -> { sent: number } (to the acting admin's linked chat) */
export const telegramAdTestSendResultSchema = z.object({ sent: z.number().int() });

// ---- analytics: GET admin/telegram/ads/stats?from=YYYY-MM-DD&to=YYYY-MM-DD[&campaignId][&creativeId] ----
export const telegramAdStatsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaignId: z.string().uuid().optional(),
  creativeId: z.string().uuid().optional(),
});

const metricsShape = {
  impressions: z.number().int(),
  clicks: z.number().int(),
  /** 👍 presses. */
  reactions: z.number().int(),
  /** "hide ads" presses. */
  hides: z.number().int(),
  /** Distinct chats that saw an ad. */
  reach: z.number().int(),
  /** clicks / impressions (0-1). */
  ctr: z.number(),
  /** (clicks + reactions) / impressions (0-1). */
  engagementRate: z.number(),
};

export const telegramAdStatsSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object(metricsShape),
  byDay: z.array(z.object({ day: z.string(), ...metricsShape })),
  byCampaign: z.array(z.object({ campaignId: z.string().uuid(), name: z.string(), ...metricsShape })),
  byCreative: z.array(
    z.object({
      creativeId: z.string().uuid(),
      name: z.string(),
      campaignId: z.string().uuid(),
      ...metricsShape,
    }),
  ),
  byTrigger: z.array(z.object({ trigger: z.enum(TELEGRAM_AD_TRIGGERS), ...metricsShape })),
});
export type TelegramAdStats = z.infer<typeof telegramAdStatsSchema>;
/** GET admin/telegram/ads/stats/export (same query) -> text/csv, one row per day x creative. */
