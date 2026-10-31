import { z } from "zod";

import { accessSettingsSchema, authSettingsSchema } from "./auth-settings.js";
import { LOCALES } from "./i18n/locales.js";
import { emailSchema, phoneNumberSchema } from "./schemas/auth.js";

import type { AiTask } from "./ai.js";

/*
 * Typed registry of every `site_settings` key (Task 1.8). Each key has a zod schema (with safe
 * defaults, so `schema.parse({})` is the default value), and a visibility: `public` keys are served
 * to anyone by `GET /settings/public` (branding, contact hub, socials, ...); `admin` keys never leave
 * the api except through permission-checked admin routes. Code holds defaults only (AGENT §5.9).
 */

const httpsUrl = z
  .url({ protocol: /^https$/ })
  .max(2_048)
  .nullable()
  .default(null);

const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/**
 * A brand image URL: https, or http for a local api only (dev and tests serve `/assets/<key>` from
 * `http://localhost:4000`). Uploaded assets get `${API_PUBLIC_URL}/assets/<key>?v=<sha>` here.
 */
const brandAssetUrl = z
  .url({ protocol: /^https?$/ })
  .max(2_048)
  .refine(
    (value) =>
      value.startsWith("https://") || /^http:\/\/(localhost|127[.]0[.]0[.]1)(:\d+)?\//.test(value),
    "https or a local address",
  )
  .nullable()
  .default(null);

const imageSide = z.number().int().min(1).max(8_192).nullable().default(null);

export const brandingSettingsSchema = z.object({
  nameAr: z.string().trim().min(1).max(60).default("وصفة AI"),
  nameEn: z.string().trim().min(1).max(60).default("Wasfa AI"),
  logoUrl: brandAssetUrl,
  /** Pixel size of the logo (read from the file at upload) so pages reserve its space: no layout shift. */
  logoWidth: imageSide,
  logoHeight: imageSide,
  logoDarkUrl: brandAssetUrl,
  faviconUrl: brandAssetUrl,
  /** The uploaded logo is assumed to carry the wordmark; set this when it is the symbol alone. */
  showNameWithLogo: z.boolean().default(false),
  /** `theme_color` / `background_color` of the manifest and `<meta name="theme-color">`. */
  themeColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default("#1e3a8a"),
  manifestName: z.string().trim().min(1).max(45).default("وصفة AI"),
  manifestShortName: z.string().trim().min(1).max(12).default("وصفة"),
});

/**
 * Homepage switches (BRAND-AND-HOMEPAGE §3.2, §3.6). `proof` figures are shown only while set, and
 * an admin sets them only from measured data (never a made-up number). The app chips turn into
 * store badges when a listing URL exists; the waitlist form shows only while `waitlistEnabled`.
 */
export const landingSettingsSchema = z.object({
  proof: z
    .object({
      /** Average analysis time in seconds, e.g. 12.5. */
      avgAnalysisSeconds: z.number().positive().max(600).nullable().default(null),
      /** Field-level accuracy from the evaluation harness, 0–100. */
      accuracyPercent: z.number().min(0).max(100).nullable().default(null),
    })
    .default({ avgAnalysisSeconds: null, accuracyPercent: null }),
  apps: z
    .object({
      androidUrl: httpsUrl,
      iosUrl: httpsUrl,
      waitlistEnabled: z.boolean().default(false),
    })
    .default({ androidUrl: null, iosUrl: null, waitlistEnabled: false }),
});

/** Floating contact hub (DESIGN-SYSTEM §5.3): each channel is hidden while it is `null`. */
export const contactSettingsSchema = z.object({
  whatsapp: phoneNumberSchema.nullable().default(null),
  /** Telegram username without `@`. */
  telegram: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{4,31}$/)
    .nullable()
    .default(null),
  phone: phoneNumberSchema.nullable().default(null),
  email: emailSchema.nullable().default(null),
});

export const socialsSettingsSchema = z.object({
  facebook: httpsUrl,
  instagram: httpsUrl,
  tiktok: httpsUrl,
  x: httpsUrl,
  youtube: httpsUrl,
});

export const localeSettingsSchema = z.object({
  defaultLocale: z.enum(LOCALES).default("ar"),
  westernDigits: z.boolean().default(true),
  showHijriDates: z.boolean().default(false),
});

export const currencySettingsSchema = z
  .object({
    default: currencyCode.default("EGP"),
    enabled: z.array(currencyCode).min(1).max(20).default(["EGP", "SAR", "AED", "USD"]),
  })
  .refine((value) => value.enabled.includes(value.default), {
    message: "default must be enabled",
    path: ["default"],
  });

export const freeTierSettingsSchema = z.object({
  monthlyAnalyses: z.number().int().min(0).max(1_000).default(3),
});

/**
 * The WhatsApp number users send their verification code to (the one the bridge is linked to).
 * Set from /admin/whatsapp; `WHATSAPP_NUMBER` in the environment is only the fallback.
 */
export const whatsappSettingsSchema = z.object({
  number: phoneNumberSchema.nullable().default(null),
  /**
   * Customer notifications sent from that number (owner decision, 2026-10-17). Off until the owner
   * switches it on in /admin/whatsapp. Only customers whose phone was verified through this
   * WhatsApp number receive them, within the caps and the sending hours; the rest get email.
   */
  customerMessages: z
    .object({
      enabled: z.boolean().default(false),
      /** Messages to customers per UTC day, all customers together. */
      dailyCap: z.number().int().min(1).max(2_000).default(300),
      /** Messages per customer per UTC day. */
      perUserDailyCap: z.number().int().min(1).max(10).default(3),
      timezone: z
        .string()
        .refine(isTimeZone, { message: "Unknown IANA time zone" })
        .default("Africa/Cairo"),
      /** Messages outside [startHour, endHour) wait for the next window. */
      startHour: z.number().int().min(0).max(23).default(9),
      endHour: z.number().int().min(1).max(24).default(21),
    })
    .refine((value) => value.endHour > value.startHour, {
      message: "endHour must be after startHour",
      path: ["endHour"],
    })
    .default({
      enabled: false,
      dailyCap: 300,
      perUserDailyCap: 3,
      timezone: "Africa/Cairo",
      startHour: 9,
      endHour: 21,
    }),
});

/** A zone `Intl` can format with; a bad value would make every business-hours check throw. */
function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const alertsSettingsSchema = z.object({
  whatsapp: z
    .object({
      enabled: z.boolean().default(false),
      dailyCap: z.number().int().min(1).max(20).default(20),
    })
    .default({ enabled: false, dailyCap: 20 }),
  businessHours: z
    .object({
      timezone: z
        .string()
        .refine(isTimeZone, { message: "Unknown IANA time zone" })
        .default("Africa/Cairo"),
      startHour: z.number().int().min(0).max(23).default(9),
      endHour: z.number().int().min(1).max(24).default(22),
      days: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
    })
    .default({ timezone: "Africa/Cairo", startHour: 9, endHour: 22, days: [0, 1, 2, 3, 4, 5, 6] }),
});

/**
 * AI spend control (Phase 2, Task 2.2). Admin only: it holds the daily spend cap and the kill
 * switches. Written through `/admin/ai/settings` (`ai.write` + `ai.killswitch`), never through the
 * generic settings route. Money is integer USD micros (1 USD = 1,000,000).
 */
export const aiSettingsSchema = z.object({
  /** Daily provider spend at which new AI work is refused (UTC day). */
  dailyCapUsdMicros: z.number().int().min(0).default(10_000_000),
  /** Percent of the cap at which the admins are alerted, once per day. */
  alertPercent: z.number().int().min(1).max(100).default(80),
  /** `all` stops everything; the others stop one feature. */
  killSwitch: z
    .object({
      all: z.boolean().default(false),
      rx: z.boolean().default(false),
      chat: z.boolean().default(false),
      search: z.boolean().default(false),
      wa_agent: z.boolean().default(false),
    })
    .default({ all: false, rx: false, chat: false, search: false, wa_agent: false }),
  /** What one credit is worth in USD micros (default $0.01). */
  creditValueUsdMicros: z.number().int().min(1).default(10_000),
  /** Preview models can disappear without notice: off unless an admin allows them. */
  allowPreviewModels: z.boolean().default(false),
});

/** Prescription analysis: what users are shown before pressing Analyze, and its limits. */
export const rxSettingsSchema = z.object({
  /** Credits charged per page of a prescription. */
  creditsPerPage: z.number().int().min(0).max(100).default(1),
  maxPages: z.number().int().min(1).max(4).default(4),
  /** Model-written warnings are off: warnings come from code (phase2.md, Decision 8). */
  modelWarnings: z.boolean().default(false),
  /** Items re-read by the verification pass. */
  verifyMaxItems: z.number().int().min(0).max(20).default(8),
  /**
   * Retired (docs/MEDICATIONS.md section 3): the worker ignores it. Recognition uses the drug database
   * iff `medications.enabled && medications.mode === "hybrid"`. The key stays so stored settings and
   * the admin form keep parsing.
   */
  drugMatching: z.boolean().default(false),
  /** Add the general information (purpose, side effects, precautions, overview) to every result. */
  details: z.boolean().default(true),
});

/** Uploaded images (Phase 2, Task 2.5): how long the pictures are kept; the analysis results stay. */
export const uploadsSettingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(365).default(30),
});

/**
 * Which plans may use each assistant skill (Task 2.4). A skill missing from the map is on for every
 * plan; `[]` turns it off everywhere. Written through `/admin/ai/skills` (`ai.write`), never through
 * the generic settings route.
 */
export const skillsSettingsSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
    z.union([z.literal("all"), z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(100)]),
  )
  .default({});

/** True when `planKey` may use `skill` under the `skills` setting. */
export function skillEnabledForPlan(
  skills: z.output<typeof skillsSettingsSchema>,
  skill: string,
  planKey: string,
): boolean {
  const rule = Object.hasOwn(skills, skill) ? skills[skill] : undefined;
  return rule === undefined || rule === "all" || rule.includes(planKey);
}

const bps = z.number().int().min(0).max(10_000);
const nonNegativeInt = z.number().int().min(0).max(1_000_000_000);

/**
 * Billing (Phase 3, BILLING §11). Admin only: the public catalog gets `billingPublicView()`. Money
 * is integer minor units; currencies are NOT duplicated here (the public `currency` setting is the
 * source for checkout currencies).
 */
export const billingSettingsSchema = z.object({
  allowFreeOrders: z.boolean().default(true),
  /** A positive total below this is raised to it or refused (`minChargeMode`), never silently dropped. */
  minChargeMinor: nonNegativeInt.default(1_000),
  minChargeMode: z.enum(["raise", "refuse"]).default("raise"),
  quoteTtlMinutes: z.number().int().min(1).max(1_440).default(15),
  orderTtlHours: z.number().int().min(1).max(720).default(24),
  graceDays: z.number().int().min(0).max(60).default(2),
  refundWindowDays: z.number().int().min(0).max(365).default(7),
  maxTotalDiscountBps: bps.default(7_000),
  /** Manual payments at or above this need a second admin. */
  fourEyesThresholdMinor: nonNegativeInt.default(500_000),
  /** An admin plan change whose list price reaches this (default currency) needs a fresh sign-in. */
  adminPlanChangeFreshAuthMinor: nonNegativeInt.default(50_000),
  reviewSlaMinutes: z.number().int().min(1).max(10_080).default(120),
  failureSpike: z
    .object({
      enabled: z.boolean().default(true),
      windowMinutes: z.number().int().min(5).max(120).default(15),
      minFailures: z.number().int().min(1).max(1_000).default(5),
      rateBps: z.number().int().min(1).max(10_000).default(5_000),
      cooldownMinutes: z.number().int().min(5).max(1_440).default(60),
    })
    .default({
      enabled: true,
      windowMinutes: 15,
      minFailures: 5,
      rateBps: 5_000,
      cooldownMinutes: 60,
    }),
  /** Retention of payment proof images, in days. */
  proofRetentionDays: z.number().int().min(1).max(3_650).default(365),
  fx: z
    .object({ usdToEgp: z.number().positive().max(100_000).default(50) })
    .default({ usdToEgp: 50 }),
  /** Legal details printed on receipts (null until the owner enters them). */
  company: z
    .object({
      legalName: z.string().trim().max(200).nullable().default(null),
      address: z.string().trim().max(500).nullable().default(null),
      taxId: z.string().trim().max(60).nullable().default(null),
    })
    .default({ legalName: null, address: null, taxId: null }),
  creditPackValidMonths: z.number().int().min(1).max(120).default(12),
  trial: z
    .object({
      /** Credits granted by a trial; 0 turns trials off. */
      credits: z.number().int().min(0).max(100_000).default(20),
      oncePerPhone: z.boolean().default(true),
    })
    .default({ credits: 20, oncePerPhone: true }),
});

/**
 * Referrals, points and withdrawals (Phase 3, REFERRALS-REWARDS §9). Admin only. Off until the owner
 * switches it on; `killSwitch` stops new rewards and withdrawals at once.
 */
export const rewardsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  killSwitch: z.boolean().default(false),
  /**
   * Real cash payouts. Off until the owner has settled the legal treatment of paying individuals with
   * an accountant (phase3.md, Open question 2); points can still be earned and converted to credits.
   */
  cashOutEnabled: z.boolean().default(false),
  /** Piasters per point: 10 means 1,000 points = 100 EGP. */
  pointValueMinor: z.number().int().min(1).max(1_000_000).default(10),
  currency: currencyCode.default("EGP"),
  minWithdrawalPoints: nonNegativeInt.default(1_000),
  maxWithdrawalPointsPerMonth: nonNegativeInt.default(100_000),
  minAccountAgeDays: z.number().int().min(0).max(365).default(7),
  destinationCooldownHours: z.number().int().min(0).max(720).default(48),
  holdDaysDefault: z.number().int().min(0).max(365).default(14),
  fourEyesThresholdPoints: nonNegativeInt.default(50_000),
  pointsPerCredit: z.number().int().min(1).max(100_000).default(5),
  creditConversionBonusBps: bps.default(2_000),
  requireFirstUsage: z.boolean().default(true),
  weeklyBudgetPoints: nonNegativeInt.default(1_000_000),
  /** Months after which unused points expire; null = never. */
  expireAfterMonths: z.number().int().min(1).max(120).nullable().default(null),
  fraud: z
    .object({
      holdSamePhone: z.boolean().default(true),
      holdSamePayer: z.boolean().default(true),
      holdSameDevice: z.boolean().default(true),
      /** Sign-ups per hour of one referrer above which everything is held and an alert is raised. */
      velocityPerHour: z.number().int().min(1).max(10_000).default(10),
    })
    .default({
      holdSamePhone: true,
      holdSamePayer: true,
      holdSameDevice: true,
      velocityPerHour: 10,
    }),
  payoutSlaHours: z.number().int().min(1).max(720).default(48),
  tiersEnabled: z.boolean().default(false),
  /** The referred person's private first-purchase coupon (REFERRALS §3.3); 0 turns the coupon off. */
  refereeFirstPaymentDiscountBps: bps.default(1_000),
  refereeCouponValidDays: z.number().int().min(1).max(365).default(30),
});

/** Conversion prompts, taste grants, lifecycle mail and experiments (Phase 3, GROWTH-STRATEGY §9). Admin only. */
export const growthSettingsSchema = z.object({
  /** Stops prompts, tastes, personal offers and lifecycle mail at once. */
  killSwitch: z.boolean().default(false),
  prompts: z
    .object({
      enabled: z.boolean().default(true),
      cooldownDays: z.number().int().min(0).max(365).default(7),
      /** The doubling cooldown after repeated dismissals never goes beyond this (GROWTH §2.6). */
      maxCooldownDays: z.number().int().min(1).max(365).default(60),
      maxPerSession: z.number().int().min(0).max(10).default(1),
    })
    .default({ enabled: true, cooldownDays: 7, maxCooldownDays: 60, maxPerSession: 1 }),
  taste: z
    .object({
      enabled: z.boolean().default(true),
      /** Global cap of free premium uses per week (cost control). */
      weeklyCap: z.number().int().min(0).max(1_000_000).default(100),
      perUserPerWeek: z.number().int().min(0).max(7).default(1),
      /** Global cap of the credits the week's tastes may cost (the credits of the taste analyses). */
      weeklyBudgetCredits: z.number().int().min(0).max(100_000_000).default(2_000),
    })
    .default({ enabled: true, weeklyCap: 100, perUserPerWeek: 1, weeklyBudgetCredits: 2_000 }),
  proof: z
    .object({ minCount: z.number().int().min(0).max(1_000_000).default(500) })
    .default({ minCount: 500 }),
  mostChosen: z
    .object({ minSample: z.number().int().min(1).max(1_000_000).default(50) })
    .default({ minSample: 50 }),
  /** The value ledger's time estimate; always shown as an estimate. */
  value: z
    .object({ minutesSavedPerAnalysis: z.number().int().min(0).max(240).default(10) })
    .default({ minutesSavedPerAnalysis: 10 }),
  lifecycle: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  marketingMail: z
    .object({
      maxPerWeek: z.number().int().min(0).max(14).default(1),
      /** No marketing mail this long after sign-up (GROWTH §6: never in the first 24 hours). */
      quietHoursAfterSignup: z.number().int().min(0).max(720).default(24),
    })
    .default({ maxPerWeek: 1, quietHoursAfterSignup: 24 }),
  experiments: z
    .object({
      /** A variant that worsens a guardrail metric by more than this is flagged red. */
      guardrailBps: bps.default(500),
      minSampleSize: z.number().int().min(1).max(10_000_000).default(200),
    })
    .default({ guardrailBps: 500, minSampleSize: 200 }),
  welcomeOffer: z
    .object({
      enabled: z.boolean().default(true),
      validityHours: z.number().int().min(1).max(720).default(48),
    })
    .default({ enabled: true, validityHours: 48 }),
  winback: z
    .object({
      enabled: z.boolean().default(true),
      validityDays: z.number().int().min(1).max(90).default(7),
    })
    .default({ enabled: true, validityDays: 7 }),
});

/** AI crawlers the owner can switch per bot (SEO-GEO §10.4); search engines are always allowed. */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
] as const;
export type AiCrawler = (typeof AI_CRAWLERS)[number];

const verificationToken = z.string().trim().min(1).max(200).nullable().default(null);

/**
 * Search and discoverability (SEO-GEO §13). Public: robots.txt, llms.txt, the IndexNow key file and
 * the verification meta tags are rendered by the web app, and none of these values is a secret (the
 * IndexNow key is published by protocol). Search Console credentials will live in an admin key.
 */
export const seoSettingsSchema = z.object({
  /** `%s` is replaced by the page title; `null` keeps the built-in "<title> | <brand>". */
  titleTemplate: z
    .string()
    .trim()
    .max(120)
    .refine((value) => value.includes("%s"), "must contain %s")
    .nullable()
    .default(null),
  defaultDescription: z.string().trim().min(1).max(300).nullable().default(null),
  verification: z
    .object({ google: verificationToken, bing: verificationToken, yandex: verificationToken })
    .default({ google: null, bing: null, yandex: null }),
  /** `true` = allowed. Missing bots default to allowed (recorded decision: allow by default). */
  aiCrawlers: z
    .partialRecord(z.enum(AI_CRAWLERS), z.boolean())
    .default({})
    .transform(
      (map) =>
        Object.fromEntries(AI_CRAWLERS.map((bot) => [bot, map[bot] ?? true])) as Record<
          AiCrawler,
          boolean
        >,
    ),
  indexNow: z
    .object({
      enabled: z.boolean().default(false),
      key: z
        .string()
        .regex(/^[A-Za-z0-9-]{8,128}$/)
        .nullable()
        .default(null),
    })
    .default({ enabled: false, key: null }),
  llmsTxt: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  defaultOgImage: brandAssetUrl,
  /** Case-insensitive pattern that splits brand from non-brand queries in the SEO reports. */
  brandRegex: z.string().trim().min(1).max(200).default("wasfa|وصفة"),
  aiReferrerHosts: z
    .array(z.string().trim().toLowerCase().min(3).max(100))
    .max(50)
    .default([
      "chatgpt.com",
      "chat.openai.com",
      "perplexity.ai",
      "claude.ai",
      "gemini.google.com",
      "copilot.microsoft.com",
    ]),
});

/** Claims an editor may not publish (CONTENT-PLATFORM §6.2): matched on Arabic-normalised, lower-case text. */
export const DEFAULT_FORBIDDEN_PHRASES = [
  "يشفي نهائيًا",
  "بدون أي آثار جانبية",
  "بدون اعراض جانبية",
  "بديل عن الطبيب",
  "بديل للطبيب",
  "علاج مضمون",
  "يعالج جميع الأمراض",
  "يعالج كل الأمراض",
  "شفاء تام",
  "شفاء مضمون",
  "آمن 100%",
  "guaranteed cure",
  "no side effects",
  "replaces your doctor",
  "cures all",
] as const;

/**
 * Editorial platform (CONTENT-PLATFORM §9): the publishing cap, preview lifetime, quality-gate
 * thresholds and auto-link limits. Admin only; the API reads it on every save and publish.
 */
export const contentSettingsSchema = z.object({
  maxPublishesPerDay: z.number().int().min(1).max(500).default(25),
  /** IANA zone whose midnight starts the publishing-cap day and in which schedules are shown. */
  timeZone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "unknown time zone")
    .default("Africa/Cairo"),
  previewTokenHours: z.number().int().min(1).max(168).default(24),
  minWords: z
    .object({
      article: z.number().int().min(0).max(10_000).default(600),
      guide: z.number().int().min(0).max(10_000).default(1_200),
      glossary: z.number().int().min(0).max(10_000).default(80),
    })
    .default({ article: 600, guide: 1_200, glossary: 80 }),
  /** Shingle-Jaccard similarity against published items of the same locale. */
  duplicate: z
    .object({
      warnAt: z.number().min(0.05).max(1).default(0.4),
      blockAt: z.number().min(0.05).max(1).default(0.6),
    })
    .refine((value) => value.warnAt < value.blockAt, "warnAt must be below blockAt")
    .default({ warnAt: 0.4, blockAt: 0.6 }),
  titleSimilarityBlockAt: z.number().min(0.5).max(1).default(0.9),
  forbiddenPhrases: z
    .array(z.string().trim().min(2).max(120))
    .max(200)
    .default([...DEFAULT_FORBIDDEN_PHRASES]),
  autoLink: z
    .object({
      enabled: z.boolean().default(true),
      maxPerTarget: z.number().int().min(1).max(5).default(1),
      minWordsBetween: z.number().int().min(0).max(1_000).default(120),
    })
    .default({ enabled: true, maxPerTarget: 1, minWordsBetween: 120 }),
  defaultAuthorId: z.uuid().nullable().default(null),
  reviewIntervalDays: z
    .object({
      general: z.number().int().min(30).max(1_095).default(365),
      highRisk: z.number().int().min(30).max(1_095).default(180),
    })
    .default({ general: 365, highRisk: 180 }),
  /** Narrower featured images raise the `image_size` warning. */
  featuredMinWidth: z.number().int().min(320).max(4_000).default(1_200),
  /** External links to these hosts (and subdomains) keep link equity; every other host gets nofollow. */
  dofollowDomains: z
    .array(z.string().trim().toLowerCase().min(3).max(100))
    .max(100)
    .default([
      "who.int",
      "nih.gov",
      "ncbi.nlm.nih.gov",
      "fda.gov",
      "ema.europa.eu",
      "edaegypt.gov.eg",
      "sfda.gov.sa",
      "cdc.gov",
      "nice.org.uk",
      "cochranelibrary.com",
    ]),
  /** An English draft may be generated from an Arabic article; it is reviewed like any other. */
  autoTranslateDrafts: z.boolean().default(false),
});

const waAgentCapsSchema = z.object({
  /** Replies (messages) to one chat per UTC hour / per UTC day. */
  perChatPerHour: z.number().int().min(1).max(200).default(20),
  perChatPerDay: z.number().int().min(1).max(1_000).default(60),
  /** Replies to all chats together per UTC day. */
  dailyTotal: z.number().int().min(1).max(20_000).default(1_500),
  maxReplyChars: z.number().int().min(50).max(4_000).default(1_200),
  maxMessagesPerTurn: z.number().int().min(1).max(10).default(3),
});

const waAgentDiscountsSchema = z.object({
  enabled: z.boolean().default(false),
  percentOff: z.number().int().min(1).max(50).default(10),
  /** Plan keys the offer may apply to; empty = all individual plans. */
  plans: z.array(z.string().trim().min(1).max(64)).max(50).default([]),
  validHours: z.number().int().min(1).max(168).default(24),
  perUserLifetime: z.number().int().min(1).max(5).default(1),
  dailyCap: z.number().int().min(0).max(1_000).default(20),
  newCustomersOnly: z.boolean().default(true),
  minUserMessages: z.number().int().min(0).max(50).default(4),
});

const waAgentMediaItemSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9_-]*$/),
  mediaAssetId: z.uuid(),
  caption: z.string().trim().max(300).optional(),
});

const waAgentVoiceSchema = z.object({
  enabled: z.boolean().default(false),
  replyMode: z.enum(["mirror", "sometimes", "never"]).default("mirror"),
  sometimesPercent: z.number().int().min(0).max(100).default(20),
  maxChars: z.number().int().min(50).max(2_000).default(600),
  voiceId: z.string().trim().max(64).default(""),
  modelId: z.string().trim().max(64).default(""),
  transcribeIncoming: z.boolean().default(true),
  /** ElevenLabs characters the agent may speak per UTC day; over it, replies stay text. */
  dailyCharCap: z.number().int().min(0).max(1_000_000).default(20_000),
  /** ElevenLabs voice settings, sent only when set (the voice's own defaults otherwise). */
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
});

/**
 * The WhatsApp AI agent (docs/WA-AGENT.md §7). Off by default and independent from
 * `auth.phoneVerification`. The ElevenLabs key is a secret and never lives here.
 */
const waAgentRuntimeSchema = z.object({
  /** Phase 6 runtime: stream entries acked after handling, dead letter, durable turns. Off = v1. */
  v2: z.boolean().default(false),
  concurrency: z.number().int().min(1).max(32).default(8),
  stepTimeoutMs: z.number().int().min(5_000).max(120_000).default(45_000),
  turnTimeoutMs: z.number().int().min(30_000).max(300_000).default(150_000),
  maxRounds: z.number().int().min(1).max(6).default(4),
  jobAttempts: z.number().int().min(0).max(5).default(3),
});

export const waAgentSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Answer numbers that are not linked to a verified account. */
  guestsEnabled: z.boolean().default(true),
  /** The pause before a reply is sent (plus or minus 25 % jitter). */
  replyDelaySeconds: z.number().int().min(3).max(60).default(10),
  typingIndicator: z.boolean().default(true),
  caps: waAgentCapsSchema.default(() => waAgentCapsSchema.parse({})),
  /** The agent's own daily AI spend cap, USD micros (1 USD = 1,000,000). */
  spendCapUsdMicros: z.number().int().min(0).max(1_000_000_000).default(5_000_000),
  persona: z.string().max(4_000).default(""),
  language: z.enum(["ar_eg", "ar", "en"]).default("ar_eg"),
  emojiLevel: z.enum(["none", "light", "lively"]).default("light"),
  /** The agent stays quiet in a chat this long after the owner types into it. */
  takeoverPauseMinutes: z.number().int().min(5).max(10_080).default(120),
  /** Transcripts and wa media are deleted after this many days. */
  retentionDays: z.number().int().min(7).max(365).default(90),
  discounts: waAgentDiscountsSchema.default(() => waAgentDiscountsSchema.parse({})),
  media: z.array(waAgentMediaItemSchema).max(30).default([]),
  voice: waAgentVoiceSchema.default(() => waAgentVoiceSchema.parse({})),
  runtime: waAgentRuntimeSchema.default(() => waAgentRuntimeSchema.parse({})),
});
export type WaAgentSettings = z.output<typeof waAgentSettingsSchema>;

const medicationsChatCardsSchema = z.object({
  enabled: z.boolean().default(true),
  max: z.number().int().min(0).max(5).default(3),
});

const medicationsSearchSchema = z.object({
  enabled: z.boolean().default(true),
  showPrices: z.boolean().default(true),
});

/**
 * The medication database and recognition engine (docs/MEDICATIONS.md §3). The defaults equal the
 * matcher constants in `drugs.ts`. `reviewScore` stays under `acceptScore`, or nothing could be
 * verified between the two.
 */
export const medicationsSettingsSchema = z
  .object({
    /** Off: recognition is AI-only, search and cards are hidden. */
    enabled: z.boolean().default(true),
    /** `ai_only`: recognition ignores the database (search still works). */
    mode: z.enum(["hybrid", "ai_only"]).default("hybrid"),
    similarityFloor: z.number().min(0).max(1).default(0.3),
    acceptScore: z.number().min(0).max(1).default(0.85),
    reviewScore: z.number().min(0).max(1).default(0.5),
    /** The top candidate must beat the best other brand family by this much to be auto-accepted. */
    minMargin: z.number().min(0).max(1).default(0.06),
    strengthBonus: z.number().min(0).max(1).default(0.1),
    strengthConflictPenalty: z.number().min(0).max(1).default(0.15),
    formBonus: z.number().min(0).max(1).default(0.05),
    maxCandidates: z.number().int().min(1).max(10).default(5),
    useAlternatives: z.boolean().default(true),
    /** Distinct users that agree before a learned alias is approved; 0 = admin only. */
    learnAutoApproveAt: z.number().int().min(0).max(20).default(3),
    logUnmatched: z.boolean().default(true),
    chatCards: medicationsChatCardsSchema.default(() => medicationsChatCardsSchema.parse({})),
    waTools: z.boolean().default(true),
    search: medicationsSearchSchema.default(() => medicationsSearchSchema.parse({})),
  })
  .refine((settings) => settings.reviewScore < settings.acceptScore, {
    path: ["reviewScore"],
    message: "must be lower than acceptScore",
  });
export type MedicationSettings = z.output<typeof medicationsSettingsSchema>;

export const SETTING_VISIBILITIES = ["public", "admin"] as const;
export type SettingVisibility = (typeof SETTING_VISIBILITIES)[number];

export const SETTINGS_REGISTRY = {
  branding: { schema: brandingSettingsSchema, visibility: "public" },
  contact: { schema: contactSettingsSchema, visibility: "public" },
  socials: { schema: socialsSettingsSchema, visibility: "public" },
  locale: { schema: localeSettingsSchema, visibility: "public" },
  currency: { schema: currencySettingsSchema, visibility: "public" },
  /** Public so the web app can show "maintenance" and "sign-up closed" states. */
  access: { schema: accessSettingsSchema, visibility: "public" },
  free_tier: { schema: freeTierSettingsSchema, visibility: "public" },
  /** Blocked email domains and the phone-verification kill switch: admin only. */
  auth: { schema: authSettingsSchema, visibility: "admin" },
  whatsapp: { schema: whatsappSettingsSchema, visibility: "admin" },
  /** The WhatsApp AI agent: its own switch, independent from `auth.phoneVerification`. */
  waAgent: { schema: waAgentSettingsSchema, visibility: "admin" },
  /** The medication database and recognition thresholds (admin only; WP2 retires `rx.drugMatching`). */
  medications: { schema: medicationsSettingsSchema, visibility: "admin" },
  alerts: { schema: alertsSettingsSchema, visibility: "admin" },
  ai: { schema: aiSettingsSchema, visibility: "admin" },
  /** Public: the price per page and the page limit are shown before a prescription is analysed. */
  rx: { schema: rxSettingsSchema, visibility: "public" },
  seo: { schema: seoSettingsSchema, visibility: "public" },
  landing: { schema: landingSettingsSchema, visibility: "public" },
  /** Admin only: the retention job reads it; users are told the number on the analysis page. */
  uploads: { schema: uploadsSettingsSchema, visibility: "admin" },
  /** Admin only: per-plan enablement of assistant skills, edited on `/admin/ai/skills`. */
  skills: { schema: skillsSettingsSchema, visibility: "admin" },
  /** Admin only: the public catalog shows a subset through `billingPublicView()`, not as a settings key. */
  billing: { schema: billingSettingsSchema, visibility: "admin" },
  rewards: { schema: rewardsSettingsSchema, visibility: "admin" },
  growth: { schema: growthSettingsSchema, visibility: "admin" },
  /** Admin only: quality-gate thresholds and the publishing cap of the editorial platform. */
  content: { schema: contentSettingsSchema, visibility: "admin" },
} as const satisfies Record<string, { schema: z.ZodType; visibility: SettingVisibility }>;

export type SettingsRegistry = typeof SETTINGS_REGISTRY;
export type SettingKey = keyof SettingsRegistry;
export type SettingValue<K extends SettingKey> = z.output<SettingsRegistry[K]["schema"]>;
export type SettingInput<K extends SettingKey> = z.input<SettingsRegistry[K]["schema"]>;

export const SETTING_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingKey[];

export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(SETTINGS_REGISTRY, value);
}

export const PUBLIC_SETTING_KEYS = SETTING_KEYS.filter(
  (key) => SETTINGS_REGISTRY[key].visibility === "public",
);
export type PublicSettingKey = {
  [K in SettingKey]: SettingsRegistry[K]["visibility"] extends "public" ? K : never;
}[SettingKey];

/** The safe default of a key (every field of every schema has a default). */
export function settingDefault<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS_REGISTRY[key].schema.parse({}) as SettingValue<K>;
}

/** `{ key: value }` for every public key: the body of `GET /settings/public` (web parses it with this). */
export const publicSettingsSchema = z.object({
  branding: brandingSettingsSchema,
  contact: contactSettingsSchema,
  socials: socialsSettingsSchema,
  locale: localeSettingsSchema,
  currency: currencySettingsSchema,
  access: accessSettingsSchema,
  free_tier: freeTierSettingsSchema,
  rx: rxSettingsSchema,
  seo: seoSettingsSchema,
  landing: landingSettingsSchema,
}) satisfies z.ZodType<{ [K in PublicSettingKey]: SettingValue<K> }>;
export type PublicSettings = z.output<typeof publicSettingsSchema>;

/** Path parameter of the admin settings routes (Task 1.10). */
export const settingKeyParamSchema = z.object({
  key: z.string().refine(isSettingKey, "unknown setting"),
});

// ---------------------------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------------------------

export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_.]{1,63}$/;
export const FLAG_RULE_TYPES = ["all", "user", "org", "percentage", "plan"] as const;
export type FlagRuleType = (typeof FLAG_RULE_TYPES)[number];

/**
 * Who an enabled flag applies to. `plan` is defined now and evaluates to false until plans exist
 * (Phase 2). Stored in `feature_flags.rules`; an empty object (the column default) means `all`.
 */
export const flagRulesSchema = z.preprocess(
  (value) =>
    value !== null && typeof value === "object" && Object.keys(value).length === 0
      ? { type: "all" }
      : value,
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("user"), userIds: z.array(z.uuid()).min(1).max(1_000) }),
    z.object({ type: z.literal("org"), orgIds: z.array(z.uuid()).min(1).max(1_000) }),
    z.object({ type: z.literal("percentage"), percentage: z.number().int().min(0).max(100) }),
    z.object({
      type: z.literal("plan"),
      plans: z
        .array(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/))
        .min(1)
        .max(50),
    }),
  ]),
);
export type FlagRules = z.output<typeof flagRulesSchema>;

export const flagKeySchema = z.string().regex(FLAG_KEY_PATTERN);

/** Admin write of one flag (Task 1.10). */
export const upsertFlagSchema = z.object({
  enabled: z.boolean(),
  rules: flagRulesSchema,
});

/** `GET /flags`: the caller's evaluated flags (unknown keys are simply absent = off). */
export const flagsResponseSchema = z.object({ flags: z.record(z.string(), z.boolean()) });

type KillSwitch = SettingValue<"ai">["killSwitch"];

/**
 * Whether the `ai` kill switches stop a task: `all`, the task's own feature switch, or (when asked
 * about search) the search switch. Helper tasks (titles, summaries) answer to `all` only. The
 * worker's router uses this; the API's `isSwitchedOff` implements the same table.
 */
export function isAiSwitchedOff(
  killSwitch: KillSwitch,
  task: AiTask,
  options: { search: boolean },
): boolean {
  if (killSwitch.all) return true;
  if (options.search) return killSwitch.search;
  switch (task) {
    case "rx_extract":
    case "rx_verify":
      return killSwitch.rx;
    case "chat":
    case "deep_think":
      return killSwitch.chat;
    case "web_search":
      return killSwitch.search;
    case "wa_agent":
      return killSwitch.wa_agent;
    default:
      return false;
  }
}
