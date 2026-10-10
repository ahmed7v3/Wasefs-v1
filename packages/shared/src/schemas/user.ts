import { z } from "zod";

import { LOCALES } from "../i18n/index.js";
import {
  ACCOUNT_TYPES,
  ONBOARDING_STEPS,
  ORG_MEMBER_ROLES,
  ORG_TYPES,
  PROFESSIONS,
  USAGE_INTENTS,
} from "../identity.js";

/*
 * `/me` contract (Task 1.7). Requests are parsed by the api; responses are parsed by the web app
 * (`api-client.ts`, Task 1.9), so both sides fail loudly on drift.
 */

export const personNameSchema = z.string().trim().min(1).max(100);

/** `PATCH /me`: at least one field. Email and phone change through their own verified flows. */
export const updateMeSchema = z
  .object({
    name: personNameSchema.optional(),
    locale: z.enum(LOCALES).optional(),
  })
  .refine((value) => value.name !== undefined || value.locale !== undefined, {
    message: "nothing to update",
  });
export type UpdateMeInput = z.input<typeof updateMeSchema>;

/** A uuid path parameter (`/me/sessions/:id`, `/orgs/:id`, ...). */
export const idParamSchema = z.object({ id: z.uuid() });

const isoDate = z.iso.datetime({ offset: true });

export const meResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** `null` for phone-only accounts (their placeholder address is never shown). */
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  image: z.string().nullable(),
  accountType: z.enum(ACCOUNT_TYPES),
  locale: z.enum(LOCALES),
  twoFactorEnabled: z.boolean(),
  /** Platform roles; empty for an ordinary user. The web app only uses them to hide UI. */
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  profile: z.object({
    displayName: z.string().nullable(),
    profession: z.enum(PROFESSIONS).nullable(),
    usageIntent: z.array(z.enum(USAGE_INTENTS)),
    country: z.string().nullable(),
    city: z.string().nullable(),
  }),
  onboarding: z.object({
    currentStep: z.enum(ONBOARDING_STEPS),
    done: z.boolean(),
  }),
  organizations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      type: z.enum(ORG_TYPES),
      role: z.enum(ORG_MEMBER_ROLES),
    }),
  ),
  /** True when the account may use tools: email or phone verified, and onboarding done. */
  canUseTools: z.boolean(),
  createdAt: isoDate,
});
export type MeResponse = z.output<typeof meResponseSchema>;

export const sessionItemSchema = z.object({
  id: z.uuid(),
  current: z.boolean(),
  createdAt: isoDate,
  /** Last time the session was refreshed (Better Auth `updated_at`). */
  lastSeenAt: isoDate,
  expiresAt: isoDate,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type SessionItem = z.output<typeof sessionItemSchema>;

export const sessionListResponseSchema = z.object({ items: z.array(sessionItemSchema) });

export const revokeSessionsResponseSchema = z.object({ revoked: z.number().int().nonnegative() });

/** `DELETE /me`: when the anonymization will happen (14 days later). */
export const deleteMeResponseSchema = z.object({ anonymizeAfter: isoDate });

/** Days between a deletion request and anonymization (support can restore within this window). */
export const ACCOUNT_DELETION_GRACE_DAYS = 14;
/** Accounts that never verified an email or phone are anonymized after this many days. */
export const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;
