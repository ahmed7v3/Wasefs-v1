import { z } from "zod";

import { accessSettingsSchema, authSettingsSchema } from "./auth-settings.js";
import { LOCALES } from "./i18n/index.js";
import { emailSchema, phoneNumberSchema } from "./schemas/auth.js";

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
  ai: { schema: aiSettingsSchema, visibility: "admin" },
  /** Public: the price per page and the page limit are shown before a prescription is analysed. */
  rx: { schema: rxSettingsSchema, visibility: "public" },
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
