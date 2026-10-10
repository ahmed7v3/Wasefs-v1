import { z } from "zod";

import { PROVIDER_IDS } from "../auth-settings.js";
import { E164_PATTERN } from "../identity.js";

/*
 * Request bodies of the `/auth/*` endpoints we expose. The api parses every body with these
 * before Better Auth sees it, so unknown keys (including anything an attacker adds to reach an
 * internal option) are stripped and field errors come back as `VALIDATION_FAILED` field paths.
 */

export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound keeps Argon2 work bounded; far above any human password. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Where the browser may be sent after an auth action: a relative path of the web app (`/dashboard`,
 * never `//host` or `/\host`) or an absolute http(s) URL. The api additionally requires absolute
 * URLs to start with one of its `WEB_ORIGIN`s, so this check only rejects the obvious.
 */
export function isSafeRedirect(value: string): boolean {
  if (value.startsWith("/")) {
    // No `//host`, no backslash tricks, no whitespace or control characters (code points <= 0x20).
    const hasControlOrSpace = [...value].some((char) => (char.codePointAt(0) ?? 0) <= 0x20);
    return !value.startsWith("//") && !value.includes("\\") && !hasControlOrSpace;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const redirectTargetSchema = z
  .string()
  .max(2_048)
  .refine(isSafeRedirect, "invalid redirect");

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Sign-in does not re-apply the length rule: it must not reveal the policy for existing accounts. */
const currentPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

const nameSchema = z.string().trim().min(1).max(100);

export const phoneNumberSchema = z.string().trim().regex(E164_PATTERN);

export const signUpEmailSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  callbackURL: redirectTargetSchema.optional(),
});

export const signInEmailSchema = z.object({
  email: emailSchema,
  password: currentPasswordSchema,
  rememberMe: z.boolean().optional(),
  callbackURL: redirectTargetSchema.optional(),
});

export const signUpPhoneSchema = z.object({
  name: nameSchema,
  phoneNumber: phoneNumberSchema,
  password: newPasswordSchema,
});

export const signInPhoneSchema = z.object({
  phoneNumber: phoneNumberSchema,
  password: currentPasswordSchema,
  rememberMe: z.boolean().optional(),
});

export const signInSocialSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  callbackURL: redirectTargetSchema.optional(),
  newUserCallbackURL: redirectTargetSchema.optional(),
  errorCallbackURL: redirectTargetSchema.optional(),
});

export const sendVerificationEmailSchema = z.object({
  email: emailSchema,
  callbackURL: redirectTargetSchema.optional(),
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
  redirectTo: redirectTargetSchema.optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: newPasswordSchema,
  token: z.string().min(1).max(512),
});

export const changePasswordSchema = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
  revokeOtherSessions: z.boolean().optional(),
});

const totpCode = z.string().regex(/^\d{6}$/);

export const twoFactorEnableSchema = z.object({ password: currentPasswordSchema });
export const twoFactorDisableSchema = z.object({ password: currentPasswordSchema });
export const twoFactorGenerateBackupCodesSchema = z.object({ password: currentPasswordSchema });
export const twoFactorVerifyTotpSchema = z.object({
  code: totpCode,
  trustDevice: z.boolean().optional(),
});
export const twoFactorVerifyBackupCodeSchema = z.object({
  code: z.string().min(1).max(64),
  trustDevice: z.boolean().optional(),
  disableSession: z.boolean().optional(),
});
