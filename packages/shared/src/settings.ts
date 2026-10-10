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

export const brandingSettingsSchema = z.object({
  nameAr: z.string().trim().min(1).max(60).default("وصفة AI"),
  nameEn: z.string().trim().min(1).max(60).default("Wasfa AI"),
  logoUrl: httpsUrl,
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
