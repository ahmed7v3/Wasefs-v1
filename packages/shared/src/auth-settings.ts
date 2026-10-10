import { z } from "zod";

/*
 * Typed shape of the `auth` and `access` site settings, used by the settings registry
 * (`settings.ts`). An unreadable or missing row falls back to the safe defaults below (Facebook
 * "coming soon", nothing blocked).
 */

/** Social sign-in providers we know about. Apple joins with the mobile app. */
export const PROVIDER_IDS = ["google", "facebook"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_STATUSES = ["enabled", "coming_soon", "disabled"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const PHONE_VERIFICATION_MODES = ["whatsapp_inbound", "disabled"] as const;
export type PhoneVerificationMode = (typeof PHONE_VERIFICATION_MODES)[number];

const emailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, "must be a domain like example.com");

export const authSettingsSchema = z.object({
  providers: z
    .object({
      google: z.enum(PROVIDER_STATUSES).default("enabled"),
      facebook: z.enum(PROVIDER_STATUSES).default("coming_soon"),
    })
    .default({ google: "enabled", facebook: "coming_soon" }),
  /** Admin-extendable on top of the bundled disposable-domain list. */
  blockedEmailDomains: z.array(emailDomain).max(5_000).default([]),
  /** Kill switch for phone verification (SECURITY.md §8). */
  phoneVerification: z.enum(PHONE_VERIFICATION_MODES).default("whatsapp_inbound"),
});

export type AuthSettings = z.output<typeof authSettingsSchema>;

export const DEFAULT_AUTH_SETTINGS: AuthSettings = authSettingsSchema.parse({});

export const accessSettingsSchema = z.object({
  signupOpen: z.boolean().default(true),
  maintenanceMode: z.boolean().default(false),
});

export type AccessSettings = z.output<typeof accessSettingsSchema>;

export const DEFAULT_ACCESS_SETTINGS: AccessSettings = accessSettingsSchema.parse({});
