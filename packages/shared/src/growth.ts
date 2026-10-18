/*
 * Closed value sets of growth measurement and admin support tooling (Phase 3, Task 3.1;
 * docs/GROWTH-STRATEGY.md §9, docs/ADMIN-CONSOLE-SPEC.md §8). Same rule as `identity.ts`: one tuple
 * types the column, builds the DB CHECK and drives the zod schemas, so they cannot drift.
 */

/** First-party funnel events: no PHI and no free text (`prompt_shown` carries its kind in `props`). */
export const GROWTH_EVENT_NAMES = [
  "pricing_viewed",
  "plan_selected",
  "checkout_started",
  "method_selected",
  "payment_submitted",
  "payment_succeeded",
  "payment_failed",
  "proof_submitted",
  "prompt_shown",
  "prompt_clicked",
  "prompt_dismissed",
  "taste_started",
  "taste_completed",
  "offer_shown",
  "offer_used",
  "referral_link_opened",
  "referral_signup",
  "referral_paid",
  "coupon_applied",
  "coupon_failed",
] as const;
export type GrowthEventName = (typeof GROWTH_EVENT_NAMES)[number];

/** `growth_events.props` is small by design: at most this many bytes of JSON text. */
export const GROWTH_EVENT_PROPS_MAX_BYTES = 2_048;

export const EXPERIMENT_STATUSES = ["draft", "running", "stopped", "completed"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/** Why an admin opened a user's health data (ADMIN-CONSOLE-SPEC §8.2); one reason per 30-minute session. */
export const PHI_ACCESS_REASONS = [
  "support_request",
  "dispute",
  "fraud_review",
  "quality_review",
] as const;
export type PhiAccessReason = (typeof PHI_ACCESS_REASONS)[number];

/** Length of one PHI access session, in minutes. */
export const PHI_ACCESS_SESSION_MINUTES = 30;

// --- Marketing consent and lifecycle mail (Phase 3, Task 3.14; GROWTH §6) -----------------------------

/** How a person left marketing mail: the footer link, the mail client's one-click button, the account page, or an admin. */
export const MARKETING_OPT_OUT_VIA = ["unsubscribe_link", "one_click", "account", "admin"] as const;
export type MarketingOptOutVia = (typeof MARKETING_OPT_OUT_VIA)[number];

/** Lifecycle mails; one row per (user, kind, period) in `growth_mail_log` makes each at-most-once. */
export const GROWTH_MAIL_KINDS = [
  "day1_guide",
  "day3_value",
  "day6_offer",
  "winback",
  "last_call",
  "value_recap",
] as const;
export type GrowthMailKind = (typeof GROWTH_MAIL_KINDS)[number];

/**
 * Header the auth controller sets from the sign-up body's `marketingOptIn` (after stripping any client
 * copy), for the user-creation hook to read: the same route the invite code takes.
 */
export const MARKETING_HEADER = "x-wasfa-marketing";

/** No marketing for this long after a refund or a complaint. */
export const MARKETING_SILENCE_AFTER_COMPLAINT_DAYS = 30;
/** Silence after the last gentle message (expiry + 30 days). */
export const MARKETING_SILENCE_AFTER_LAST_CALL_DAYS = 90;
/** `growth_mail_log` and `growth_events` are kept this long, then deleted by a worker job. */
export const GROWTH_RETENTION_MONTHS = 13;

/** Consent is an opt-in that no later opt-out has withdrawn. */
export function hasMarketingConsent(prefs: {
  marketingOptedInAt: Date | null;
  marketingOptedOutAt: Date | null;
}): boolean {
  if (prefs.marketingOptedInAt === null) return false;
  return (
    prefs.marketingOptedOutAt === null ||
    prefs.marketingOptedOutAt.getTime() < prefs.marketingOptedInAt.getTime()
  );
}

// --- Prompts, tastes, offers ---------------------------------------------------------------------------

export const GROWTH_PROMPT_CONTEXTS = ["dashboard", "result", "credits", "pricing", "locked"] as const;
export type GrowthPromptContext = (typeof GROWTH_PROMPT_CONTEXTS)[number];

export const GROWTH_PROMPT_KINDS = [
  "analysis_taste",
  "credits_low",
  "credits_out",
  "locked_feature",
  "org_usage",
  "expiring_free_credits",
  "plan_expiring",
] as const;
export type GrowthPromptKind = (typeof GROWTH_PROMPT_KINDS)[number];

export const GROWTH_CTA_KINDS = ["taste", "pricing", "pack", "renew", "analyze"] as const;
export type GrowthCtaKind = (typeof GROWTH_CTA_KINDS)[number];

/** Locked features the client may report when the user touches one (`context=locked&feature=`). */
export const GROWTH_LOCKED_FEATURES = ["deep", "web_search"] as const;
export type GrowthLockedFeature = (typeof GROWTH_LOCKED_FEATURES)[number];

/** The analyses on which the "taste of Deep" prompt appears: the 1st, 3rd and 10th finished one. */
export const TASTE_PROMPT_ANALYSIS_NUMBERS = [1, 3, 10] as const;

/** `taste_grants.feature` of the premium mode a taste lets a free user try once. */
export const TASTE_FEATURE = "deep_mode";

/** `plan_expiring` fires at these day marks before the end (GROWTH §4). */
export const PLAN_EXPIRING_DAYS = [7, 3, 1] as const;
/** `expiring_free_credits` fires this many days before the month ends. */
export const EXPIRING_CREDITS_DAYS = 3;
/** `credits_low` fires from this share of the monthly credits used. */
export const CREDITS_LOW_USED_PERCENT = 70;
/** `org_usage` fires from this many members or this many analyses a month. */
export const ORG_USAGE_MIN_MEMBERS = 3;
export const ORG_USAGE_MIN_ANALYSES = 40;

/** One upgrade prompt per session: the Redis key that reserves it (reserved on `shown`, never on GET). */
export function promptSessionKey(sessionId: string): string {
  return `growth:prompt:session:${sessionId}`;
}
export const PROMPT_SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * How long a dismissed or shown prompt stays quiet: `cooldownDays x 2^(dismissals - 1)`, never beyond
 * `maxCooldownDays`. Without a dismissal the plain cooldown applies after a `shown`.
 */
export function promptCooldownDays(
  cooldownDays: number,
  maxCooldownDays: number,
  dismissals: number,
): number {
  const exponent = Math.max(0, dismissals - 1);
  // 2^exponent overflows long before it matters; the cap makes any large exponent moot.
  const factor = exponent > 20 ? 2 ** 20 : 2 ** exponent;
  return Math.min(maxCooldownDays, cooldownDays * factor);
}

// --- Experiments: stable bucketing -----------------------------------------------------------------------

/** FNV-1a (32 bit) followed by murmur3's finalizer, so near-identical ids still spread evenly. */
export function hashBucket(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) % 100;
}

/**
 * The variant of one user (or, before sign-in, one session) in one experiment: a pure function of
 * `experimentKey:id`, so the same person always sees the same variant. Weights are percents that add
 * up to 100; the bucket (0-99) falls into the variant whose cumulative range holds it.
 */
export function variantFor(
  id: string,
  experimentKey: string,
  variants: readonly { key: string; weight: number }[],
): string {
  const bucket = hashBucket(`${experimentKey}:${id}`);
  let upTo = 0;
  for (const variant of variants) {
    upTo += variant.weight;
    if (bucket < upTo) return variant.key;
  }
  const last = variants.at(-1);
  if (last === undefined) throw new RangeError("An experiment needs at least one variant");
  return last.key;
}

/** The experiment whose variants decide the copy of each prompt kind (`experiments.key`). */
export function promptExperimentKey(kind: GrowthPromptKind): string {
  return `prompt_${kind}`;
}
