import { CURRENCY_CODE_PATTERN, BILLING_KEY_PATTERN, MAX_BPS } from "@wasfa/shared/billing";
import {
  POINTS_BUCKETS,
  POINTS_LEDGER_KINDS,
  POINTS_REFERENCE_TYPES,
  REFERRAL_FRAUD_SCORE_MAX,
  REFERRAL_SOURCES,
  REFERRAL_STATUSES,
  REWARD_BENEFICIARIES,
  REWARD_DECISION_OUTCOMES,
  REWARD_EVENTS,
  REWARD_KINDS,
  REWARD_REDEEMABLE_AS,
  SHA256_HEX_PATTERN,
  WITHDRAWAL_STATUSES,
} from "@wasfa/shared/rewards";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { files } from "./files.js";
import { organizations } from "./organizations.js";
import { referralCodes, referralPrograms } from "./referral-codes.js";
import { users } from "./users.js";

/*
 * Referrals, points and withdrawals (Phase 3, Task 3.1; docs/REFERRALS-REWARDS.md). Points are plain
 * integers. Balances change only in the same transaction as their `points_ledger` rows, under
 * `SELECT ... FOR UPDATE` on the wallet (lock order: order, referral, wallet).
 */

/** The attribution record: fixed at registration (first touch wins), so a later link cannot re-assign it. */
export const referrals = pgTable(
  "referrals",
  {
    id: idColumn(),
    refereeUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" })
      .unique("referrals_referee_user_id_key"),
    // Null when the code belongs to an organization or a campaign.
    referrerUserId: uuid().references(() => users.id, { onDelete: "restrict" }),
    referrerOrgId: uuid().references(() => organizations.id, { onDelete: "set null" }),
    codeId: uuid()
      .notNull()
      .references(() => referralCodes.id, { onDelete: "restrict" }),
    programId: uuid()
      .notNull()
      .references(() => referralPrograms.id, { onDelete: "restrict" }),
    source: text({ enum: REFERRAL_SOURCES }).notNull().default("code"),
    status: text({ enum: REFERRAL_STATUSES }).notNull().default("pending"),
    fraudScore: integer().notNull().default(0),
    // Names of the fraud rules that fired.
    flags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (table) => [
    check("referrals_source_check", inList(table.source, REFERRAL_SOURCES)),
    check("referrals_status_check", inList(table.status, REFERRAL_STATUSES)),
    check(
      "referrals_fraud_score_check",
      sql`${table.fraudScore} between 0 and ${sql.raw(String(REFERRAL_FRAUD_SCORE_MAX))}`,
    ),
    check(
      "referrals_self_check",
      sql`${table.referrerUserId} is null or ${table.referrerUserId} <> ${table.refereeUserId}`,
    ),
    index("referrals_referrer_user_idx")
      .on(table.referrerUserId)
      .where(sql`${table.referrerUserId} is not null`),
    index("referrals_code_idx").on(table.codeId),
    // The fraud queue.
    index("referrals_held_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'held'`),
  ],
);

/** "When EVENT happens, give BENEFICIARY a REWARD"; the most specific active rule wins (REFERRALS §3.2). */
export const rewardRules = pgTable(
  "reward_rules",
  {
    id: idColumn(),
    programId: uuid()
      .notNull()
      .references(() => referralPrograms.id, { onDelete: "cascade" }),
    event: text({ enum: REWARD_EVENTS }).notNull(),
    beneficiary: text({ enum: REWARD_BENEFICIARIES }).notNull(),
    rewardKind: text({ enum: REWARD_KINDS }).notNull(),
    // Points, basis points or credits depending on `reward_kind`.
    value: integer().notNull(),
    redeemableAs: text({ enum: REWARD_REDEEMABLE_AS }).notNull(),
    holdDays: integer().notNull().default(0),
    maxPerReferrerPerDay: integer(),
    maxPerReferrerTotal: integer(),
    minOrderMinor: integer(),
    validFrom: timestamp({ withTimezone: true }),
    validTo: timestamp({ withTimezone: true }),
    maxRenewals: integer(),
    priority: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    check("reward_rules_event_check", inList(table.event, REWARD_EVENTS)),
    check("reward_rules_beneficiary_check", inList(table.beneficiary, REWARD_BENEFICIARIES)),
    check("reward_rules_reward_kind_check", inList(table.rewardKind, REWARD_KINDS)),
    check("reward_rules_redeemable_as_check", inList(table.redeemableAs, REWARD_REDEEMABLE_AS)),
    check(
      "reward_rules_value_check",
      sql`${table.value} >= 0 and (${table.rewardKind} <> 'percent_of_net_bps' or ${table.value} <= ${sql.raw(String(MAX_BPS))})`,
    ),
    check("reward_rules_hold_days_check", sql`${table.holdDays} between 0 and 365`),
    check(
      "reward_rules_limits_check",
      sql`(${table.maxPerReferrerPerDay} is null or ${table.maxPerReferrerPerDay} > 0)
        and (${table.maxPerReferrerTotal} is null or ${table.maxPerReferrerTotal} > 0)
        and (${table.minOrderMinor} is null or ${table.minOrderMinor} >= 0)
        and (${table.maxRenewals} is null or ${table.maxRenewals} > 0)`,
    ),
    check(
      "reward_rules_period_check",
      sql`${table.validFrom} is null or ${table.validTo} is null or ${table.validTo} > ${table.validFrom}`,
    ),
    index("reward_rules_program_event_idx").on(table.programId, table.event, table.beneficiary),
  ],
);

/** Every evaluation outcome is recorded, including the ones that paid nothing (held, denied). */
export const rewardDecisions = pgTable(
  "reward_decisions",
  {
    id: idColumn(),
    referralId: uuid()
      .notNull()
      .references(() => referrals.id, { onDelete: "restrict" }),
    ruleId: uuid().references(() => rewardRules.id, { onDelete: "set null" }),
    event: text({ enum: REWARD_EVENTS }).notNull(),
    beneficiary: text({ enum: REWARD_BENEFICIARIES }).notNull(),
    outcome: text({ enum: REWARD_DECISION_OUTCOMES }).notNull(),
    reason: text(),
    points: integer().notNull().default(0),
    idempotencyKey: text().notNull().unique("reward_decisions_idempotency_key_key"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("reward_decisions_event_check", inList(table.event, REWARD_EVENTS)),
    check("reward_decisions_beneficiary_check", inList(table.beneficiary, REWARD_BENEFICIARIES)),
    check("reward_decisions_outcome_check", inList(table.outcome, REWARD_DECISION_OUTCOMES)),
    check("reward_decisions_points_check", sql`${table.points} >= 0`),
    // The fraud queue and the referral timeline.
    index("reward_decisions_referral_created_idx").on(table.referralId, table.createdAt),
    index("reward_decisions_held_idx")
      .on(table.createdAt)
      .where(sql`${table.outcome} = 'held_for_review'`),
  ],
);

export const referralTiers = pgTable(
  "referral_tiers",
  {
    id: idColumn(),
    programId: uuid()
      .notNull()
      .references(() => referralPrograms.id, { onDelete: "cascade" }),
    key: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    // Paid referrals in the last 12 months needed to reach the tier.
    minPaidReferrals: integer().notNull(),
    // Added to the `percent_of_net_bps` rules.
    bonusBps: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique("referral_tiers_program_key_key").on(table.programId, table.key),
    unique("referral_tiers_program_min_key").on(table.programId, table.minPaidReferrals),
    check("referral_tiers_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("referral_tiers_min_paid_check", sql`${table.minPaidReferrals} >= 0`),
    check(
      "referral_tiers_bonus_bps_check",
      sql`${table.bonusBps} between 0 and ${sql.raw(String(MAX_BPS))}`,
    ),
  ],
);

/** Three buckets per user (REFERRALS §1); each is an integer that can never go below zero. */
export const pointsWallets = pgTable(
  "points_wallets",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" })
      .unique("points_wallets_user_id_key"),
    pending: integer().notNull().default(0),
    cash: integer().notNull().default(0),
    creditOnly: integer().notNull().default(0),
    lifetimeEarned: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    check("points_wallets_pending_check", sql`${table.pending} >= 0`),
    check("points_wallets_cash_check", sql`${table.cash} >= 0`),
    check("points_wallets_credit_only_check", sql`${table.creditOnly} >= 0`),
    check("points_wallets_lifetime_earned_check", sql`${table.lifetimeEarned} >= 0`),
  ],
);

/*
 * Append-only, like credit_ledger: the `wasfa_api` role has SELECT and INSERT only (migration 0011).
 * `amount` is signed; rows of one movement share a `group_id`; `idempotency_key` makes a retry a no-op.
 */
export const pointsLedger = pgTable(
  "points_ledger",
  {
    id: idColumn(),
    walletId: uuid()
      .notNull()
      .references(() => pointsWallets.id, { onDelete: "restrict" }),
    groupId: uuid().notNull(),
    kind: text({ enum: POINTS_LEDGER_KINDS }).notNull(),
    bucket: text({ enum: POINTS_BUCKETS }).notNull(),
    amount: integer().notNull(),
    referenceType: text({ enum: POINTS_REFERENCE_TYPES }),
    referenceId: uuid(),
    ruleId: uuid().references(() => rewardRules.id, { onDelete: "set null" }),
    idempotencyKey: text().notNull().unique("points_ledger_idempotency_key_key"),
    // For `reward_pending` rows: when the hold ends.
    releaseAt: timestamp({ withTimezone: true }),
    actorId: uuid().references(() => users.id, { onDelete: "set null" }),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("points_ledger_kind_check", inList(table.kind, POINTS_LEDGER_KINDS)),
    check("points_ledger_bucket_check", inList(table.bucket, POINTS_BUCKETS)),
    check("points_ledger_amount_check", sql`${table.amount} <> 0`),
    check(
      "points_ledger_reference_check",
      sql`(${table.referenceType} is null) = (${table.referenceId} is null)`,
    ),
    check(
      "points_ledger_reference_type_check",
      sql`${table.referenceType} is null or ${inList(table.referenceType, POINTS_REFERENCE_TYPES)}`,
    ),
    index("points_ledger_wallet_created_idx").on(table.walletId, table.createdAt),
    index("points_ledger_group_idx").on(table.groupId),
    // The hourly release job.
    index("points_ledger_release_idx")
      .on(table.releaseAt)
      .where(sql`${table.kind} = 'reward_pending' and ${table.releaseAt} is not null`),
  ],
);

/** A clawed-back reward that was already spent: offset against future earnings, waivable by an admin. */
export const rewardDebts = pgTable(
  "reward_debts",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: integer().notNull(),
    remaining: integer().notNull(),
    reason: text().notNull(),
    referralId: uuid().references(() => referrals.id, { onDelete: "set null" }),
    waivedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    waivedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    check("reward_debts_amount_check", sql`${table.amount} > 0`),
    check(
      "reward_debts_remaining_check",
      sql`${table.remaining} >= 0 and ${table.remaining} <= ${table.amount}`,
    ),
    index("reward_debts_user_open_idx")
      .on(table.userId)
      .where(sql`${table.remaining} > 0`),
  ],
);

/** Where a withdrawal can be paid (admin data). `field_schema` describes the destination fields. */
export const payoutMethods = pgTable(
  "payout_methods",
  {
    id: idColumn(),
    key: text().notNull().unique("payout_methods_key_key"),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    fieldSchema: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean().notNull().default(false),
    feeMinor: integer().notNull().default(0),
    minAmountMinor: integer(),
    maxAmountMinor: integer(),
    noteAr: text(),
    noteEn: text(),
    // Null = every country.
    countries: text().array(),
    sort: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    check("payout_methods_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("payout_methods_field_schema_check", sql`jsonb_typeof(${table.fieldSchema}) = 'object'`),
    check("payout_methods_fee_check", sql`${table.feeMinor} >= 0`),
    check(
      "payout_methods_amount_range_check",
      sql`(${table.minAmountMinor} is null or ${table.minAmountMinor} >= 0)
        and (${table.maxAmountMinor} is null or ${table.maxAmountMinor} >= 0)
        and (${table.minAmountMinor} is null or ${table.maxAmountMinor} is null or ${table.maxAmountMinor} >= ${table.minAmountMinor})`,
    ),
  ],
);

/**
 * A user's saved payout destination. The value is sealed (AES-256-GCM, never plaintext); `masked` is
 * what the UI shows; `destination_hash` (SHA-256) makes a destination usable on only one account.
 */
export const payoutDestinations = pgTable(
  "payout_destinations",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    methodId: uuid()
      .notNull()
      .references(() => payoutMethods.id, { onDelete: "restrict" }),
    valueEnc: text().notNull(),
    masked: text().notNull(),
    destinationHash: text().notNull().unique("payout_destinations_destination_hash_key"),
    // New or changed destinations start a cooldown before they can receive money.
    usableAfter: timestamp({ withTimezone: true }).notNull(),
    // Removed by the user; kept so the hash still blocks reuse on another account.
    removedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    check(
      "payout_destinations_destination_hash_check",
      matches(table.destinationHash, SHA256_HEX_PATTERN.source),
    ),
    index("payout_destinations_user_idx").on(table.userId),
  ],
);

export const withdrawalRequests = pgTable(
  "withdrawal_requests",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Client-chosen idempotency key: a retried request does not withdraw twice.
    requestId: uuid().notNull(),
    destinationId: uuid()
      .notNull()
      .references(() => payoutDestinations.id, { onDelete: "restrict" }),
    points: integer().notNull(),
    // Snapshot at request time: the cash value and the rate used.
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    rateMinorPerPoint: integer().notNull(),
    feeMinor: integer().notNull().default(0),
    status: text({ enum: WITHDRAWAL_STATUSES }).notNull().default("requested"),
    approvedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp({ withTimezone: true }),
    secondApprovedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    secondApprovedAt: timestamp({ withTimezone: true }),
    paidBy: uuid().references(() => users.id, { onDelete: "set null" }),
    paidAt: timestamp({ withTimezone: true }),
    transferReference: text(),
    proofFileId: uuid().references(() => files.id, { onDelete: "set null" }),
    rejectReason: text(),
    flags: jsonb().$type<string[]>().notNull().default([]),
    ...timestamps(),
  },
  (table) => [
    unique("withdrawal_requests_user_request_key").on(table.userId, table.requestId),
    uniqueIndex("withdrawal_requests_transfer_reference_key")
      .on(table.transferReference)
      .where(sql`${table.transferReference} is not null`),
    check("withdrawal_requests_points_check", sql`${table.points} > 0`),
    check(
      "withdrawal_requests_amount_check",
      sql`${table.amountMinor} >= 0 and ${table.feeMinor} >= 0 and ${table.rateMinorPerPoint} > 0`,
    ),
    check(
      "withdrawal_requests_currency_check",
      matches(table.currency, CURRENCY_CODE_PATTERN.source),
    ),
    check("withdrawal_requests_status_check", inList(table.status, WITHDRAWAL_STATUSES)),
    check(
      "withdrawal_requests_paid_check",
      sql`${table.status} <> 'paid' or (${table.transferReference} is not null and ${table.paidAt} is not null)`,
    ),
    check("withdrawal_requests_flags_check", sql`jsonb_typeof(${table.flags}) = 'array'`),
    // The admin queue.
    index("withdrawal_requests_status_created_idx").on(table.status, table.createdAt),
    index("withdrawal_requests_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

export type Referral = typeof referrals.$inferSelect;
export type NewReferral = typeof referrals.$inferInsert;
export type RewardRule = typeof rewardRules.$inferSelect;
export type NewRewardRule = typeof rewardRules.$inferInsert;
export type RewardDecision = typeof rewardDecisions.$inferSelect;
export type NewRewardDecision = typeof rewardDecisions.$inferInsert;
export type ReferralTier = typeof referralTiers.$inferSelect;
export type NewReferralTier = typeof referralTiers.$inferInsert;
export type PointsWallet = typeof pointsWallets.$inferSelect;
export type NewPointsWallet = typeof pointsWallets.$inferInsert;
export type PointsLedgerEntry = typeof pointsLedger.$inferSelect;
export type NewPointsLedgerEntry = typeof pointsLedger.$inferInsert;
export type RewardDebt = typeof rewardDebts.$inferSelect;
export type NewRewardDebt = typeof rewardDebts.$inferInsert;
export type PayoutMethod = typeof payoutMethods.$inferSelect;
export type NewPayoutMethod = typeof payoutMethods.$inferInsert;
export type PayoutDestination = typeof payoutDestinations.$inferSelect;
export type NewPayoutDestination = typeof payoutDestinations.$inferInsert;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;
export type NewWithdrawalRequest = typeof withdrawalRequests.$inferInsert;
