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
