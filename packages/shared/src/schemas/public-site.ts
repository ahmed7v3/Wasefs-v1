import { z } from "zod";

import { LOCALES } from "../i18n/index.js";

import { cursorQuerySchema } from "./admin.js";
import { emailSchema } from "./auth.js";

/*
 * Public-site endpoints of Phase 4 Release A: the apps waitlist (BRAND-AND-HOMEPAGE §3.6), the
 * first-party web-vitals beacon (phase4 WP1 §2.6) and AI-crawler hit counting (WP1 §5.8). None of
 * them stores an IP address or a user id. Counters live in Redis as daily hashes (90-day TTL).
 */

// ---------------------------------------------------------------------------------------------
// Apps waitlist: `POST /public/app-waitlist` → 202 `{ received: true }` (also when already listed,
// so the form cannot be used to test whether an address is on the list).

export const APP_PLATFORMS = ["android", "ios", "both"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const appWaitlistSchema = z.object({
  email: emailSchema,
  platform: z.enum(APP_PLATFORMS).default("both"),
  /** Explicit opt-in to the launch email; the form cannot be sent without it. */
  marketingConsent: z.literal(true),
  locale: z.enum(LOCALES),
});
export type AppWaitlistInput = z.input<typeof appWaitlistSchema>;

export const appWaitlistResponseSchema = z.object({ received: z.literal(true) });

// ---------------------------------------------------------------------------------------------
// Web vitals: `POST /public/vitals` (sent with `navigator.sendBeacon`, `text/plain` body holding
// JSON, so no CORS preflight) → 204. The page samples 25 % of views before sending anything.

export const WEB_VITAL_NAMES = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

/**
 * Upper bounds of the histogram buckets per metric (ms; CLS in thousandths). A value above the last
 * bound goes to an overflow bucket. p75 is read from the cumulative bucket counts.
 */
export const WEB_VITAL_BUCKETS: Record<WebVitalName, readonly number[]> = {
  LCP: [500, 1000, 1500, 2000, 2500, 3000, 4000, 6000, 10000],
  FCP: [300, 600, 900, 1200, 1800, 2500, 3000, 4000, 6000],
  TTFB: [100, 200, 300, 500, 800, 1200, 1800, 3000],
  INP: [50, 100, 200, 300, 500, 800, 1500],
  CLS: [10, 25, 50, 100, 150, 250, 400],
};

/** A route template, never a concrete URL with ids or query (e.g. `/`, `/en`, `/pricing`). */
export const routeTemplateSchema = z
  .string()
  .max(120)
  .regex(/^\/[a-z0-9/_\-[\]]*$/);

export const webVitalSchema = z.object({
  name: z.enum(WEB_VITAL_NAMES),
  /** ms for timings, the raw layout-shift score for CLS (the api multiplies it by 1000). */
  value: z.number().min(0).max(120_000),
  route: routeTemplateSchema,
});

export const webVitalsBeaconSchema = z.object({
  metrics: z.array(webVitalSchema).min(1).max(5),
});
export type WebVitalsBeacon = z.infer<typeof webVitalsBeaconSchema>;

// ---------------------------------------------------------------------------------------------
// Bot hits: the web proxy reports requests from known crawlers to `POST /internal/bot-hits` on
// `API_INTERNAL_URL` (Docker network) → 204. Caddy answers 404 for `/internal/*` on the public api
// domain, so only containers on the internal network reach it.

export const BOT_CLASSES = [
  "googlebot",
  "bingbot",
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "claudebot",
  "claude-user",
  "perplexitybot",
  "perplexity-user",
  "google-extended",
  "applebot",
  "ccbot",
  "bytespider",
  "meta-externalagent",
  "other-bot",
] as const;
export type BotClass = (typeof BOT_CLASSES)[number];

export const botHitSchema = z.object({
  bot: z.enum(BOT_CLASSES),
  route: routeTemplateSchema,
});

export const botHitsSchema = z.object({ hits: z.array(botHitSchema).min(1).max(50) });
export type BotHits = z.infer<typeof botHitsSchema>;

// ---------------------------------------------------------------------------------------------
// Admin read model: `GET /admin/site-health?days=7` (permission `settings.read`).

export const siteHealthQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

export const siteHealthSchema = z.object({
  days: z.number().int(),
  vitals: z.array(
    z.object({
      route: z.string(),
      name: z.enum(WEB_VITAL_NAMES),
      samples: z.number().int(),
      /** Upper bound of the bucket holding the 75th percentile; `null` = overflow bucket. */
      p75: z.number().nullable(),
    }),
  ),
  bots: z.array(z.object({ bot: z.enum(BOT_CLASSES), route: z.string(), hits: z.number().int() })),
});
export type SiteHealth = z.infer<typeof siteHealthSchema>;

// ---------------------------------------------------------------------------------------------
// Admin: `GET /admin/app-waitlist` (paged, newest first) and `GET /admin/app-waitlist.csv`.

export const adminAppWaitlistQuerySchema = cursorQuerySchema.extend({
  platform: z.enum(APP_PLATFORMS).optional(),
});
export type AdminAppWaitlistQuery = z.output<typeof adminAppWaitlistQuerySchema>;

export const adminAppWaitlistResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      email: z.string(),
      platform: z.enum(APP_PLATFORMS),
      locale: z.enum(LOCALES),
      consentAt: z.string(),
      notifiedAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
  /** Everyone on the list (not only this page). */
  total: z.number().int().min(0),
});
export type AdminAppWaitlistResponse = z.infer<typeof adminAppWaitlistResponseSchema>;
