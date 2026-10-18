import { z } from "zod";

import { accessSettingsSchema, authSettingsSchema } from "./auth-settings.js";
import { LOCALES } from "./i18n/index.js";
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
    })
    .default({ all: false, rx: false, chat: false, search: false }),
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
  verifyMaxItems: z.number().int().min(0).max(20).default(5),
  /**
   * Match every line to the drug database and re-read doubtful ones against it. Off by default: the
   * model reads on its own (with the strong skill prompt) and confidence comes from the model alone.
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
  alerts: { schema: alertsSettingsSchema, visibility: "admin" },
  ai: { schema: aiSettingsSchema, visibility: "admin" },
  /** Public: the price per page and the page limit are shown before a prescription is analysed. */
  rx: { schema: rxSettingsSchema, visibility: "public" },
  /** Admin only: the retention job reads it; users are told the number on the analysis page. */
  uploads: { schema: uploadsSettingsSchema, visibility: "admin" },
  /** Admin only: per-plan enablement of assistant skills, edited on `/admin/ai/skills`. */
  skills: { schema: skillsSettingsSchema, visibility: "admin" },
  /** Admin only: the public catalog shows a subset through `billingPublicView()`, not as a settings key. */
  billing: { schema: billingSettingsSchema, visibility: "admin" },
  rewards: { schema: rewardsSettingsSchema, visibility: "admin" },
  growth: { schema: growthSettingsSchema, visibility: "admin" },
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
    default:
      return false;
  }
}
