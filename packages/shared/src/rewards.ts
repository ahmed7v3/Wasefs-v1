/*
 * Closed value sets of referrals, points, withdrawals and deals (Phase 3, Task 3.1;
 * docs/REFERRALS-REWARDS.md). Same rule as `identity.ts`: one tuple types the column, builds the DB
 * CHECK and drives the zod schemas, so they cannot drift. Points are plain integers.
 */

export const REFERRAL_PROGRAM_KINDS = ["standard", "partner", "organization"] as const;
export type ReferralProgramKind = (typeof REFERRAL_PROGRAM_KINDS)[number];

export const REFERRAL_CODE_KINDS = ["user", "partner", "organization", "campaign"] as const;
export type ReferralCodeKind = (typeof REFERRAL_CODE_KINDS)[number];

/** 3 to 20 upper-case letters and digits (7 generated; a one-time vanity edit may be 3-20). */
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

/** How the referred user reached us (first touch wins). */
export const REFERRAL_SOURCES = ["code", "link", "campaign", "join_link", "admin"] as const;
export type ReferralSource = (typeof REFERRAL_SOURCES)[number];

export const REFERRAL_STATUSES = [
  "pending",
  "qualified",
  "rewarded",
  "held",
  "blocked",
  "void",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const REFERRAL_FRAUD_SCORE_MAX = 100;

export const REWARD_EVENTS = [
  "referee_verified",
  "first_payment",
  "renewal",
  "credit_pack",
  "org_member_joined",
] as const;
export type RewardEvent = (typeof REWARD_EVENTS)[number];

export const REWARD_BENEFICIARIES = ["referrer", "referee"] as const;
export type RewardBeneficiary = (typeof REWARD_BENEFICIARIES)[number];

export const REWARD_KINDS = ["fixed_points", "percent_of_net_bps", "fixed_credits"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const REWARD_REDEEMABLE_AS = ["cash_or_credits", "credits_only"] as const;
export type RewardRedeemableAs = (typeof REWARD_REDEEMABLE_AS)[number];

export const REWARD_DECISION_OUTCOMES = ["granted", "held_for_review", "denied"] as const;
export type RewardDecisionOutcome = (typeof REWARD_DECISION_OUTCOMES)[number];

/** Where a points balance lives (REFERRALS §1). */
export const POINTS_BUCKETS = ["pending", "cash", "credit_only"] as const;
export type PointsBucket = (typeof POINTS_BUCKETS)[number];

export const POINTS_LEDGER_KINDS = [
  "reward_pending",
  "reward_release",
  "reward_reverse",
  "convert_to_credits",
  "withdraw_hold",
  "withdraw_paid",
  "withdraw_release",
  "admin_adjust",
  "expiry",
] as const;
export type PointsLedgerKind = (typeof POINTS_LEDGER_KINDS)[number];

export const POINTS_REFERENCE_TYPES = [
  "referral",
  "order",
  "withdrawal",
  "conversion",
  "admin",
] as const;
export type PointsReferenceType = (typeof POINTS_REFERENCE_TYPES)[number];

export const WITHDRAWAL_STATUSES = [
  "requested",
  "approved",
  "paid",
  "rejected",
  "canceled",
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

/** Lower-case hex SHA-256 (destination hash). */
export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

// --- Deals and join links (REFERRALS §7) ------------------------------------------------------

export const DEAL_STATUSES = ["draft", "active", "paused", "ended"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_TARGET_KINDS = ["user", "organization", "referral_code", "email_domain"] as const;
export type DealTargetKind = (typeof DEAL_TARGET_KINDS)[number];

export const DEAL_BILLING_MODES = ["self_pay", "org_pays", "manual_invoice"] as const;
export type DealBillingMode = (typeof DEAL_BILLING_MODES)[number];

export const JOIN_LINK_APPROVALS = ["auto_approve", "requires_approval"] as const;
export type JoinLinkApproval = (typeof JOIN_LINK_APPROVALS)[number];

/** URL slug of an organization join link or a campaign link. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Verified email domain a deal can target, e.g. `alnour-pharmacy.com`. */
export const EMAIL_DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// --- Codes, attribution and the user's rewards page (Task 3.11) ----------------------------------

/** Generated personal codes are this long; the one-time vanity edit may be 3-20 characters. */
export const REFERRAL_CODE_LENGTH = 7;

/** First-party cookie set by `/r/<code>`; read at sign-up when the form did not carry the code. */
export const REFERRAL_COOKIE = "wasfa_ref";
export const REFERRAL_COOKIE_MAX_AGE_DAYS = 30;

/**
 * Header the auth controller sets (after stripping any client copy) from the register form's
 * `referralCode`, so the user-creation hook can read it next to the cookie.
 */
export const REFERRAL_HEADER = "x-wasfa-referral";

/**
 * Brand, role and abusive words a vanity code may not contain. Matching is on the whole code and on
 * any substring of 4 or more letters, which keeps `WASFA2026` out without banning every short code.
 */
export const REFERRAL_VANITY_DENYLIST = [
  "WASFA",
  "ADMIN",
  "SUPPORT",
  "OFFICIAL",
  "STAFF",
  "MODERATOR",
  "ROOT",
  "FUCK",
  "SHIT",
  "SEX",
  "PORN",
  "NAZI",
] as const;

export function isReservedReferralCode(code: string): boolean {
  const upper = code.toUpperCase();
  return REFERRAL_VANITY_DENYLIST.some(
    (word) => upper === word || (word.length >= 4 && upper.includes(word)),
  );
}

/** Months of paid referrals that count toward a tier. */
export const REFERRAL_TIER_WINDOW_MONTHS = 12;

/** Why a decision paid nothing (or was held); the value is stored on `reward_decisions.reason`. */
export const REWARD_DECISION_REASONS = [
  "program_off",
  "no_rule",
  "no_referrer_user",
  "referral_blocked",
  "min_order",
  "zero_amount",
  "renewals_exhausted",
  "daily_limit",
  "total_limit",
  "held_same_phone",
  "held_same_payer",
  "held_same_device",
  "held_velocity",
  "held_weekly_budget",
  "referral_held",
  "debt_offset",
  "paid",
] as const;
export type RewardDecisionReason = (typeof REWARD_DECISION_REASONS)[number];

/**
 * Credits for `points` at the admin's rate: `points / pointsPerCredit`, plus the conversion bonus,
 * rounded down. Integer arithmetic only; the preview and the conversion call this one function so
 * the amount shown is the amount given.
 */
export function creditsForPoints(
  points: number,
  pointsPerCredit: number,
  bonusBps: number,
): number {
  if (!Number.isSafeInteger(points) || points <= 0) return 0;
  return Math.floor((points * (10_000 + bonusBps)) / (pointsPerCredit * 10_000));
}

/**
 * First letters of the first and last name, e.g. "م. أ." for «محمد أحمد». The only form of a
 * referred person's name a referrer ever sees; never the email, phone or full name.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0];
  if (first === undefined) return "";
  const letters = [first, ...(words.length > 1 ? [words[words.length - 1] ?? ""] : [])];
  return letters.map((word) => `${Array.from(word)[0]?.toLocaleUpperCase() ?? ""}.`).join(" ");
}

/**
 * The reward event a ledger row's `reason` names. Pending and release rows carry
 * `<event>:<redeemable_as>`, reversals `<cause>:<event>:<redeemable_as>`; null for anything else.
 */
export function rewardEventOfReason(reason: string | null): RewardEvent | null {
  if (reason === null) return null;
  const parts = reason.split(":");
  const candidate = parts[0] === "refund" || parts[0] === "void" ? parts[1] : parts[0];
  return (REWARD_EVENTS as readonly string[]).includes(candidate ?? "")
    ? (candidate as RewardEvent)
    : null;
}

/** Names a fraud rule can leave in `referrals.flags` (REFERRALS §6). */
export const REFERRAL_FRAUD_FLAGS = [
  "same_phone",
  "same_payer",
  "same_device",
  "velocity",
  "weekly_budget",
] as const;
export type ReferralFraudFlag = (typeof REFERRAL_FRAUD_FLAGS)[number];

/** What an amount needs of a rule: how it pays and how much. */
export interface RewardAmountRule {
  rewardKind: RewardKind;
  value: number;
}

/**
 * Points and credits a rule pays for an event worth `netMinor` (the paid subtotal without tax and
 * fees): fixed points, fixed credits, or `percent_of_net_bps` (plus `tierBonusBps`) of the net,
 * converted at the point value and rounded down. The one computation: the reward engine pays with
 * it and the admin what-if previews with it, so the preview is what is paid.
 */
export function rewardPointsFor(
  rule: RewardAmountRule,
  netMinor: number,
  settings: { pointValueMinor: number },
  tierBonusBps: number,
): { points: number; credits: number } {
  if (rule.rewardKind === "fixed_points") return { points: rule.value, credits: 0 };
  if (rule.rewardKind === "fixed_credits") return { points: 0, credits: rule.value };
  const bps = rule.value + tierBonusBps;
  return { points: Math.floor((netMinor * bps) / (10_000 * settings.pointValueMinor)), credits: 0 };
}
