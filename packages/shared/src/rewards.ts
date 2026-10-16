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
