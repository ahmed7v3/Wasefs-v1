/*
 * Closed value sets for identity and organization data.
 *
 * They live here, not in `packages/db`, because the same lists drive three things that must never
 * drift apart: the DB CHECK constraints, the zod schemas of the API (Task 1.7) and the web forms.
 * The DB stores them as `text` + CHECK (not Postgres enums) so adding a value is a one-line
 * migration instead of an `ALTER TYPE`.
 */

export const ACCOUNT_TYPES = ["individual", "organization"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const USER_STATUSES = ["active", "suspended", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROFESSIONS = [
  "pharmacist",
  "doctor",
  "nurse",
  "student",
  "patient",
  "other",
] as const;
export type Profession = (typeof PROFESSIONS)[number];

export const ORG_TYPES = ["pharmacy", "clinic", "hospital", "other"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** Role inside one organization. Global (platform) roles are a different thing: see `permissions.ts`. */
export const ORG_MEMBER_ROLES = ["org_admin", "org_member"] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

/** A membership awaiting an org admin's approval (join link `requires_approval`) is `pending` and grants nothing. */
export const ORG_MEMBER_STATUSES = ["active", "pending"] as const;
export type OrgMemberStatus = (typeof ORG_MEMBER_STATUSES)[number];

/** Onboarding wizard steps in order (ARCHITECTURE §3). `done` is the terminal state. */
export const ONBOARDING_STEPS = [
  "account_type",
  "phone",
  "name",
  "organization",
  "profession_intent",
  "plan_picker",
  "social_follow",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Why someone uses Wasfa, chosen in onboarding (marketing segmentation). Stored in
 * `user_profiles.usage_intent` (a text array checked by the api against this list).
 */
export const USAGE_INTENTS = [
  "prescription_reading",
  "drug_information",
  "patient_counseling",
  "pharmacy_work",
  "clinical_practice",
  "study",
  "personal_health",
  "other",
] as const;
export type UsageIntent = (typeof USAGE_INTENTS)[number];

/** Onboarding steps the user may pass without answering. */
export const OPTIONAL_ONBOARDING_STEPS = ["social_follow"] as const satisfies readonly OnboardingStep[];

/** E.164: `+`, a non-zero first digit, 8-15 digits in total. Same rule as the DB CHECK on phones (written without backslashes so the DB can inline `.source`). */
export const E164_PATTERN = /^[+][1-9][0-9]{7,14}$/;

/** ISO 3166-1 alpha-2, upper case. Same rule as the DB CHECK on country codes. */
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * Phone-registered accounts have no real email, but `users.email` is required and unique. They get
 * a placeholder on a reserved TLD (RFC 2606 `.invalid`), so it can never receive mail or collide
 * with a real address. Never display it, never send to it.
 */
export const PHONE_PLACEHOLDER_EMAIL_DOMAIN = "phone.wasfa.invalid";

/**
 * What an anonymized account looks like (DATABASE.md §5): the email becomes
 * `deleted-<user id>@anonymized.invalid` (still unique) and the name this fixed marker, which the
 * web app translates ("deleted user") wherever a name is shown.
 */
export const ANONYMIZED_EMAIL_DOMAIN = "anonymized.invalid";
export const ANONYMIZED_USER_NAME = "deleted-user";

export function isPlaceholderEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`);
}
