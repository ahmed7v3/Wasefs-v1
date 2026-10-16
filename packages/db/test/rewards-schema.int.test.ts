import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../src/client.js";
import { API_DB_ROLE, setApiRolePassword } from "../src/migrations.js";
import {
  dealTargets,
  deals,
  orders,
  organizationJoinLinks,
  organizationMemberLimits,
  organizationMembers,
  organizations,
  payoutDestinations,
  payoutMethods,
  plans,
  pointsLedger,
  pointsWallets,
  referralCodes,
  referralPrograms,
  referralTiers,
  referrals,
  rewardDebts,
  rewardDecisions,
  rewardRules,
  users,
  withdrawalRequests,
} from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import {
  itHasNames,
  rejection,
  sqlState,
  unique,
  uniqueKey,
  urlFor,
  type NameSpec,
} from "./schema-kit.js";

/*
 * Phase 3 referrals, points, withdrawals and deals (migration 0011). Constraint names are listed by
 * hand; every CHECK is also exercised with a violating row.
 */

const SPEC: NameSpec = {
  checks: [
    "deal_targets_kind_check",
    "deal_targets_target_check",
    "deal_targets_email_domain_check",
    "deals_status_check",
    "deals_period_check",
    "deals_terms_check",
    "deals_name_check",
    "organization_join_links_slug_check",
    "organization_join_links_role_check",
    "organization_join_links_approval_check",
    "organization_join_links_uses_check",
    "organization_member_limits_cap_check",
    "referral_codes_code_check",
    "referral_codes_kind_check",
    "referral_codes_owner_check",
    "referral_programs_key_check",
    "referral_programs_kind_check",
    "payout_destinations_destination_hash_check",
    "payout_methods_key_check",
    "payout_methods_field_schema_check",
    "payout_methods_fee_check",
    "payout_methods_amount_range_check",
    "points_ledger_kind_check",
    "points_ledger_bucket_check",
    "points_ledger_amount_check",
    "points_ledger_reference_check",
    "points_ledger_reference_type_check",
    "points_wallets_pending_check",
    "points_wallets_cash_check",
    "points_wallets_credit_only_check",
    "points_wallets_lifetime_earned_check",
    "referral_tiers_key_check",
    "referral_tiers_min_paid_check",
    "referral_tiers_bonus_bps_check",
    "referrals_source_check",
    "referrals_status_check",
    "referrals_fraud_score_check",
    "referrals_self_check",
    "reward_debts_amount_check",
    "reward_debts_remaining_check",
    "reward_decisions_event_check",
    "reward_decisions_beneficiary_check",
    "reward_decisions_outcome_check",
    "reward_decisions_points_check",
    "reward_rules_event_check",
    "reward_rules_beneficiary_check",
    "reward_rules_reward_kind_check",
    "reward_rules_redeemable_as_check",
    "reward_rules_value_check",
    "reward_rules_hold_days_check",
    "reward_rules_limits_check",
    "reward_rules_period_check",
    "withdrawal_requests_points_check",
    "withdrawal_requests_amount_check",
    "withdrawal_requests_currency_check",
    "withdrawal_requests_status_check",
    "withdrawal_requests_paid_check",
    "withdrawal_requests_flags_check",
  ],
  uniques: [
    "organization_join_links_slug_key",
    "organization_member_limits_pkey",
    "referral_codes_code_key",
    "referral_programs_key_key",
    "payout_destinations_destination_hash_key",
    "payout_methods_key_key",
    "points_ledger_idempotency_key_key",
    "points_wallets_user_id_key",
    "referral_tiers_program_key_key",
    "referral_tiers_program_min_key",
    "referrals_referee_user_id_key",
    "reward_decisions_idempotency_key_key",
    "withdrawal_requests_user_request_key",
  ],
  indexes: [
    "deal_targets_deal_idx",
    "deal_targets_user_idx",
    "deal_targets_org_idx",
    "deal_targets_code_idx",
    "deal_targets_domain_idx",
    "organization_join_links_org_idx",
    "referral_codes_user_kind_key",
    "referral_codes_owner_user_idx",
    "payout_destinations_user_idx",
    "points_ledger_wallet_created_idx",
    "points_ledger_group_idx",
    "points_ledger_release_idx",
    "referrals_referrer_user_idx",
    "referrals_code_idx",
    "referrals_held_idx",
    "reward_debts_user_open_idx",
    "reward_decisions_referral_created_idx",
    "reward_decisions_held_idx",
    "reward_rules_program_event_idx",
    "withdrawal_requests_transfer_reference_key",
    "withdrawal_requests_status_created_idx",
    "withdrawal_requests_user_created_idx",
  ],
  foreignKeys: [
    ["deal_targets_deal_id_deals_id_fk", "cascade"],
    ["deal_targets_target_user_id_users_id_fk", "cascade"],
    ["deal_targets_target_org_id_organizations_id_fk", "cascade"],
    ["deal_targets_referral_code_id_referral_codes_id_fk", "cascade"],
    ["deals_created_by_users_id_fk", "set null"],
    ["organization_join_links_org_id_organizations_id_fk", "cascade"],
    ["organization_join_links_deal_id_deals_id_fk", "set null"],
    ["organization_join_links_created_by_users_id_fk", "set null"],
    ["organization_member_limits_set_by_users_id_fk", "set null"],
    ["organization_member_limits_member_fk", "cascade"],
    ["referral_codes_program_id_referral_programs_id_fk", "restrict"],
    ["referral_codes_owner_user_id_users_id_fk", "restrict"],
    ["referral_codes_owner_org_id_organizations_id_fk", "cascade"],
    ["referral_codes_created_by_users_id_fk", "set null"],
    ["payout_destinations_user_id_users_id_fk", "restrict"],
    ["payout_destinations_method_id_payout_methods_id_fk", "restrict"],
    ["points_ledger_wallet_id_points_wallets_id_fk", "restrict"],
    ["points_ledger_rule_id_reward_rules_id_fk", "set null"],
    ["points_ledger_actor_id_users_id_fk", "set null"],
    ["points_wallets_user_id_users_id_fk", "restrict"],
    ["referral_tiers_program_id_referral_programs_id_fk", "cascade"],
    ["referrals_referee_user_id_users_id_fk", "restrict"],
    ["referrals_referrer_user_id_users_id_fk", "restrict"],
    ["referrals_referrer_org_id_organizations_id_fk", "set null"],
    ["referrals_code_id_referral_codes_id_fk", "restrict"],
    ["referrals_program_id_referral_programs_id_fk", "restrict"],
    ["reward_debts_user_id_users_id_fk", "restrict"],
    ["reward_debts_referral_id_referrals_id_fk", "set null"],
    ["reward_debts_waived_by_users_id_fk", "set null"],
    ["reward_decisions_referral_id_referrals_id_fk", "restrict"],
    ["reward_decisions_rule_id_reward_rules_id_fk", "set null"],
    ["reward_rules_program_id_referral_programs_id_fk", "cascade"],
    ["withdrawal_requests_user_id_users_id_fk", "restrict"],
    ["withdrawal_requests_destination_id_payout_destinations_id_fk", "restrict"],
    ["withdrawal_requests_approved_by_users_id_fk", "set null"],
    ["withdrawal_requests_second_approved_by_users_id_fk", "set null"],
    ["withdrawal_requests_paid_by_users_id_fk", "set null"],
    ["withdrawal_requests_proof_file_id_files_id_fk", "set null"],
    ["orders_deal_id_deals_id_fk", "set null"],
    ["organization_members_join_link_fk", "set null"],
    ["coupons_referral_code_id_referral_codes_id_fk", "cascade"],
  ],
};

let fixture: TestDb;
let api: ReturnType<typeof createDb>;
const API_PASSWORD = "api-password-4";

beforeAll(async () => {
  fixture = await startTestDb();
  await setApiRolePassword(fixture.handle.db, API_PASSWORD);
  api = createDb({ url: urlFor(fixture.url, API_DB_ROLE, API_PASSWORD), max: 1 });
}, 180_000);

afterAll(async () => {
  await api?.close();
  await fixture?.stop();
});

const db = () => fixture.handle.db;
const bad = (value: unknown): never => value as never;
const DAY = 86_400_000;
const HASH = "b".repeat(64);
let serial = 0;
/** A referral code that satisfies `^[A-Z0-9]{3,20}$`. */
const newCode = () => `TST${String(++serial).padStart(5, "0")}`;
const newHash = () => String(++serial).padStart(64, "c");

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error("insert returned no row");
  return row;
}

const newUser = () =>
  one(
    db()
      .insert(users)
      .values({ name: "Test", email: `${unique("user")}@example.com` })
      .returning(),
  );
const newOrg = (createdBy: string) =>
  one(
    db()
      .insert(organizations)
      .values({ name: "Org", type: "pharmacy", country: "EG", createdBy })
      .returning(),
  );
const newProgram = () =>
  one(
    db()
      .insert(referralPrograms)
      .values({ key: uniqueKey("prog"), kind: "standard", nameAr: "برنامج", nameEn: "Program" })
      .returning(),
  );
const newCodeRow = (programId: string, overrides: object = {}) =>
  one(
    db()
      .insert(referralCodes)
      .values({ code: newCode(), kind: "campaign", programId, ...overrides } as never)
      .returning(),
  );
const newWallet = (userId: string) =>
  one(db().insert(pointsWallets).values({ userId }).returning());
const newMethod = () =>
  one(
    db()
      .insert(payoutMethods)
      .values({ key: uniqueKey("payout"), nameAr: "ا", nameEn: "a" })
      .returning(),
  );
const newDestination = (userId: string, methodId: string) =>
  one(
    db()
      .insert(payoutDestinations)
      .values({
        userId,
        methodId,
        valueEnc: "v1:sealed",
        masked: "010••••7026",
        destinationHash: newHash(),
        usableAfter: new Date(),
      })
      .returning(),
  );
const newDeal = () => one(db().insert(deals).values({ name: "Deal", terms: {} }).returning());

interface Ctx {
  user: typeof users.$inferSelect;
  other: typeof users.$inferSelect;
  org: typeof organizations.$inferSelect;
  program: typeof referralPrograms.$inferSelect;
  code: typeof referralCodes.$inferSelect;
  referral: typeof referrals.$inferSelect;
  rule: typeof rewardRules.$inferSelect;
  wallet: typeof pointsWallets.$inferSelect;
  method: typeof payoutMethods.$inferSelect;
  destination: typeof payoutDestinations.$inferSelect;
}
const ctx = {} as Ctx;

beforeAll(async () => {
  ctx.user = await newUser();
  ctx.other = await newUser();
  ctx.org = await newOrg(ctx.user.id);
  ctx.program = await newProgram();
  ctx.code = await newCodeRow(ctx.program.id, { kind: "user", ownerUserId: ctx.user.id });
  ctx.referral = await one(
    db()
      .insert(referrals)
      .values({
        refereeUserId: ctx.other.id,
        referrerUserId: ctx.user.id,
        codeId: ctx.code.id,
        programId: ctx.program.id,
      })
      .returning(),
  );
  ctx.rule = await one(
    db()
      .insert(rewardRules)
      .values({
        programId: ctx.program.id,
        event: "first_payment",
        beneficiary: "referrer",
        rewardKind: "fixed_points",
        value: 10,
        redeemableAs: "cash_or_credits",
      })
      .returning(),
  );
  ctx.wallet = await newWallet(ctx.user.id);
  ctx.method = await newMethod();
  ctx.destination = await newDestination(ctx.user.id, ctx.method.id);
}, 180_000);

type Case = readonly [constraint: string, run: () => Promise<unknown>];

function checkCases(): Case[] {
  const ruleValues = (overrides: object = {}) =>
    ({
      programId: ctx.program.id,
      event: "renewal",
      beneficiary: "referrer",
      rewardKind: "fixed_points",
      value: 10,
      redeemableAs: "credits_only",
      ...overrides,
    }) as typeof rewardRules.$inferInsert;
  const decision = (overrides: object = {}) =>
    ({
      referralId: ctx.referral.id,
      event: "first_payment",
      beneficiary: "referrer",
      outcome: "granted",
      idempotencyKey: unique("decision"),
      ...overrides,
    }) as typeof rewardDecisions.$inferInsert;
  const ledger = (overrides: object = {}) =>
    ({
      walletId: ctx.wallet.id,
      groupId: randomUUID(),
      kind: "reward_pending",
      bucket: "pending",
      amount: 10,
      idempotencyKey: unique("ledger"),
      ...overrides,
    }) as typeof pointsLedger.$inferInsert;
  const withdrawal = (overrides: object = {}) =>
    ({
      userId: ctx.user.id,
      requestId: randomUUID(),
      destinationId: ctx.destination.id,
      points: 1_000,
      amountMinor: 10_000,
      currency: "EGP",
      rateMinorPerPoint: 10,
      ...overrides,
    }) as typeof withdrawalRequests.$inferInsert;
  const payoutMethod = (overrides: object = {}) =>
    ({
      key: uniqueKey("payout"),
      nameAr: "ا",
      nameEn: "a",
      ...overrides,
    }) as typeof payoutMethods.$inferInsert;
  const target = (overrides: object = {}) =>
    ({
      targetKind: "user",
      targetUserId: ctx.user.id,
      ...overrides,
    }) as typeof dealTargets.$inferInsert;
  const link = (overrides: object = {}) =>
    ({
      orgId: ctx.org.id,
      slug: unique("join"),
      ...overrides,
    }) as typeof organizationJoinLinks.$inferInsert;
  const tier = (overrides: object = {}) =>
    ({
      programId: ctx.program.id,
      key: uniqueKey("tier"),
      nameAr: "ا",
      nameEn: "a",
      minPaidReferrals: 5,
      ...overrides,
    }) as typeof referralTiers.$inferInsert;
  const newReferee = async () => (await newUser()).id;

  return [
    // Deals.
    [
      "deals_status_check",
      () =>
        db()
          .insert(deals)
          .values({ name: "D", terms: {}, status: bad("live") }),
    ],
    [
      "deals_period_check",
      () =>
        db()
          .insert(deals)
          .values({
            name: "D",
            terms: {},
            startsAt: new Date(Date.now() + DAY),
            endsAt: new Date(),
          }),
    ],
    [
      "deals_terms_check",
      () =>
        db()
          .insert(deals)
          .values({ name: "D", terms: bad([]) }),
    ],
    ["deals_name_check", () => db().insert(deals).values({ name: "  ", terms: {} })],
    [
      "deal_targets_kind_check",
      async () =>
        db()
          .insert(dealTargets)
          .values({ ...target({ targetKind: "x" }), dealId: (await newDeal()).id }),
    ],
    [
      "deal_targets_target_check",
      async () =>
        db()
          .insert(dealTargets)
          .values({ ...target({ targetUserId: null }), dealId: (await newDeal()).id }),
    ],
    [
      "deal_targets_email_domain_check",
      async () =>
        db()
          .insert(dealTargets)
          .values({
            ...target({
              targetKind: "email_domain",
              targetUserId: null,
              emailDomain: "Bad Domain",
            }),
            dealId: (await newDeal()).id,
          }),
    ],
    [
      "organization_join_links_slug_check",
      () =>
        db()
          .insert(organizationJoinLinks)
          .values(link({ slug: "A!" })),
    ],
    [
      "organization_join_links_role_check",
      () =>
        db()
          .insert(organizationJoinLinks)
          .values(link({ role: "owner" })),
    ],
    [
      "organization_join_links_approval_check",
      () =>
        db()
          .insert(organizationJoinLinks)
          .values(link({ approval: "never" })),
    ],
    [
      "organization_join_links_uses_check",
      () =>
        db()
          .insert(organizationJoinLinks)
          .values(link({ maxUses: 1, usedCount: 2 })),
    ],
    [
      "organization_member_limits_cap_check",
      async () => {
        const user = await newUser();
        await db().insert(organizationMembers).values({ orgId: ctx.org.id, userId: user.id });
        await db()
          .insert(organizationMemberLimits)
          .values({ orgId: ctx.org.id, userId: user.id, monthlyCreditCap: -1 });
      },
    ],

    // Programs, codes, referrals.
    [
      "referral_programs_key_check",
      () =>
        db()
          .insert(referralPrograms)
          .values({ key: "K", kind: "standard", nameAr: "ا", nameEn: "a" }),
    ],
    [
      "referral_programs_kind_check",
      () =>
        db()
          .insert(referralPrograms)
          .values({ key: uniqueKey("prog"), kind: bad("vip"), nameAr: "ا", nameEn: "a" }),
    ],
    [
      "referral_codes_code_check",
      () =>
        db()
          .insert(referralCodes)
          .values({ code: "ab", kind: "campaign", programId: ctx.program.id }),
    ],
    [
      "referral_codes_kind_check",
      () =>
        db()
          .insert(referralCodes)
          .values({ code: newCode(), kind: bad("vip"), programId: ctx.program.id }),
    ],
    [
      "referral_codes_owner_check",
      () =>
        db().insert(referralCodes).values({
          code: newCode(),
          kind: "partner",
          programId: ctx.program.id,
          ownerUserId: ctx.user.id,
          ownerOrgId: ctx.org.id,
        }),
    ],
    [
      "referrals_source_check",
      async () =>
        db()
          .insert(referrals)
          .values({
            refereeUserId: await newReferee(),
            codeId: ctx.code.id,
            programId: ctx.program.id,
            source: bad("ad"),
          }),
    ],
    [
      "referrals_status_check",
      async () =>
        db()
          .insert(referrals)
          .values({
            refereeUserId: await newReferee(),
            codeId: ctx.code.id,
            programId: ctx.program.id,
            status: bad("done"),
          }),
    ],
    [
      "referrals_fraud_score_check",
      async () =>
        db()
          .insert(referrals)
          .values({
            refereeUserId: await newReferee(),
            codeId: ctx.code.id,
            programId: ctx.program.id,
            fraudScore: 101,
          }),
    ],
    [
      "referrals_self_check",
      async () => {
        const user = await newUser();
        await db().insert(referrals).values({
          refereeUserId: user.id,
          referrerUserId: user.id,
          codeId: ctx.code.id,
          programId: ctx.program.id,
        });
      },
    ],
    [
      "referral_tiers_key_check",
      () =>
        db()
          .insert(referralTiers)
          .values(tier({ key: "T" })),
    ],
    [
      "referral_tiers_min_paid_check",
      () =>
        db()
          .insert(referralTiers)
          .values(tier({ minPaidReferrals: -1 })),
    ],
    [
      "referral_tiers_bonus_bps_check",
      () =>
        db()
          .insert(referralTiers)
          .values(tier({ bonusBps: 10_001 })),
    ],

    // Rules and decisions.
    [
      "reward_rules_event_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ event: "signup" })),
    ],
    [
      "reward_rules_beneficiary_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ beneficiary: "friend" })),
    ],
    [
      "reward_rules_reward_kind_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ rewardKind: "cash" })),
    ],
    [
      "reward_rules_redeemable_as_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ redeemableAs: "cash" })),
    ],
    [
      "reward_rules_value_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ rewardKind: "percent_of_net_bps", value: 10_001 })),
    ],
    [
      "reward_rules_hold_days_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ holdDays: 366 })),
    ],
    [
      "reward_rules_limits_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ maxPerReferrerPerDay: 0 })),
    ],
    [
      "reward_rules_period_check",
      () =>
        db()
          .insert(rewardRules)
          .values(ruleValues({ validFrom: new Date(Date.now() + DAY), validTo: new Date() })),
    ],
    [
      "reward_decisions_event_check",
      () =>
        db()
          .insert(rewardDecisions)
          .values(decision({ event: "signup" })),
    ],
    [
      "reward_decisions_beneficiary_check",
      () =>
        db()
          .insert(rewardDecisions)
          .values(decision({ beneficiary: "friend" })),
    ],
    [
      "reward_decisions_outcome_check",
      () =>
        db()
          .insert(rewardDecisions)
          .values(decision({ outcome: "maybe" })),
    ],
    [
      "reward_decisions_points_check",
      () =>
        db()
          .insert(rewardDecisions)
          .values(decision({ points: -1 })),
    ],

    // Points.
    [
      "points_wallets_pending_check",
      async () =>
        db()
          .insert(pointsWallets)
          .values({ userId: (await newUser()).id, pending: -1 }),
    ],
    [
      "points_wallets_cash_check",
      async () =>
        db()
          .insert(pointsWallets)
          .values({ userId: (await newUser()).id, cash: -1 }),
    ],
    [
      "points_wallets_credit_only_check",
      async () =>
        db()
          .insert(pointsWallets)
          .values({ userId: (await newUser()).id, creditOnly: -1 }),
    ],
    [
      "points_wallets_lifetime_earned_check",
      async () =>
        db()
          .insert(pointsWallets)
          .values({ userId: (await newUser()).id, lifetimeEarned: -1 }),
    ],
    [
      "points_ledger_kind_check",
      () =>
        db()
          .insert(pointsLedger)
          .values(ledger({ kind: "bonus" })),
    ],
    [
      "points_ledger_bucket_check",
      () =>
        db()
          .insert(pointsLedger)
          .values(ledger({ bucket: "vault" })),
    ],
    [
      "points_ledger_amount_check",
      () =>
        db()
          .insert(pointsLedger)
          .values(ledger({ amount: 0 })),
    ],
    [
      "points_ledger_reference_check",
      () =>
        db()
          .insert(pointsLedger)
          .values(ledger({ referenceType: "order" })),
    ],
    [
      "points_ledger_reference_type_check",
      () =>
        db()
          .insert(pointsLedger)
          .values(ledger({ referenceType: "invoice", referenceId: randomUUID() })),
    ],
    [
      "reward_debts_amount_check",
      () =>
        db()
          .insert(rewardDebts)
          .values({ userId: ctx.user.id, amount: 0, remaining: 0, reason: "refund" }),
    ],
    [
      "reward_debts_remaining_check",
      () =>
        db()
          .insert(rewardDebts)
          .values({ userId: ctx.user.id, amount: 5, remaining: 6, reason: "refund" }),
    ],

    // Payouts and withdrawals.
    [
      "payout_methods_key_check",
      () =>
        db()
          .insert(payoutMethods)
          .values(payoutMethod({ key: "K" })),
    ],
    [
      "payout_methods_field_schema_check",
      () =>
        db()
          .insert(payoutMethods)
          .values(payoutMethod({ fieldSchema: [] })),
    ],
    [
      "payout_methods_fee_check",
      () =>
        db()
          .insert(payoutMethods)
          .values(payoutMethod({ feeMinor: -1 })),
    ],
    [
      "payout_methods_amount_range_check",
      () =>
        db()
          .insert(payoutMethods)
          .values(payoutMethod({ minAmountMinor: 500, maxAmountMinor: 100 })),
    ],
    [
      "payout_destinations_destination_hash_check",
      () =>
        db().insert(payoutDestinations).values({
          userId: ctx.user.id,
          methodId: ctx.method.id,
          valueEnc: "v1:sealed",
          masked: "010••••7026",
          destinationHash: "xyz",
          usableAfter: new Date(),
        }),
    ],
    [
      "withdrawal_requests_points_check",
      () =>
        db()
          .insert(withdrawalRequests)
          .values(withdrawal({ points: 0 })),
    ],
    [
      "withdrawal_requests_amount_check",
      () =>
        db()
          .insert(withdrawalRequests)
          .values(withdrawal({ rateMinorPerPoint: 0 })),
    ],
    [
      "withdrawal_requests_currency_check",
      () =>
        db()
          .insert(withdrawalRequests)
          .values(withdrawal({ currency: "e" })),
    ],
    [
      "withdrawal_requests_status_check",
      () =>
        db()
          .insert(withdrawalRequests)
          .values(withdrawal({ status: "done" })),
    ],
    [
      "withdrawal_requests_paid_check",
      () =>
        db()
          .insert(withdrawalRequests)
          .values(withdrawal({ status: "paid" })),
    ],
    [
      "withdrawal_requests_flags_check",
      () =>
        db()
          .insert(withdrawalRequests)
          .values(withdrawal({ flags: bad({}) })),
    ],
  ];
}

describe("Phase 3 rewards schema: names", () => {
  itHasNames(db, SPEC);

  it("exercises every CHECK with a violating row (no check is only named, never tried)", () => {
    const covered = new Set(checkCases().map(([name]) => name));
    expect(SPEC.checks.filter((name) => !covered.has(name))).toEqual([]);
  });
});

describe("Phase 3 rewards schema: CHECK constraints", () => {
  const names = checkCases().map(([name]) => name);
  it.each(names.map((name, index) => [name, index] as const))("%s", async (name, index) => {
    const entry = checkCases()[index];
    expect(entry?.[0]).toBe(name);
    expect(await rejection(() => entry?.[1]() ?? Promise.resolve())).toBe(name);
  });
});

describe("Phase 3 rewards schema: unique constraints and idempotency keys", () => {
  it("programs and codes: unique key and code; one personal code per user", async () => {
    const program = await newProgram();
    expect(
      await rejection(() =>
        db()
          .insert(referralPrograms)
          .values({ key: program.key, kind: "standard", nameAr: "ا", nameEn: "a" }),
      ),
    ).toBe("referral_programs_key_key");

    const owner = await newUser();
    const code = await newCodeRow(program.id, { kind: "user", ownerUserId: owner.id });
    expect(
      await rejection(() =>
        db()
          .insert(referralCodes)
          .values({ code: code.code, kind: "campaign", programId: program.id }),
      ),
    ).toBe("referral_codes_code_key");
    expect(
      await rejection(() => newCodeRow(program.id, { kind: "user", ownerUserId: owner.id })),
    ).toBe("referral_codes_user_kind_key");
    await newCodeRow(program.id, { kind: "partner", ownerUserId: owner.id });
  });

  it("referrals: a user can be referred only once (first touch wins)", async () => {
    const referee = await newUser();
    const row = { refereeUserId: referee.id, codeId: ctx.code.id, programId: ctx.program.id };
    await db().insert(referrals).values(row);
    expect(await rejection(() => db().insert(referrals).values(row))).toBe(
      "referrals_referee_user_id_key",
    );
  });

  it("tiers: unique key and threshold per program", async () => {
    const program = await newProgram();
    const row = {
      programId: program.id,
      key: "silver",
      nameAr: "ا",
      nameEn: "a",
      minPaidReferrals: 5,
    };
    await db().insert(referralTiers).values(row);
    expect(
      await rejection(() =>
        db()
          .insert(referralTiers)
          .values({ ...row, minPaidReferrals: 6 }),
      ),
    ).toBe("referral_tiers_program_key_key");
    expect(
      await rejection(() =>
        db()
          .insert(referralTiers)
          .values({ ...row, key: "gold" }),
      ),
    ).toBe("referral_tiers_program_min_key");
  });

  it("points: one wallet per user; a ledger idempotency key is used once", async () => {
    expect(await rejection(() => db().insert(pointsWallets).values({ userId: ctx.user.id }))).toBe(
      "points_wallets_user_id_key",
    );
    const row = {
      walletId: ctx.wallet.id,
      groupId: randomUUID(),
      kind: "reward_pending" as const,
      bucket: "pending" as const,
      amount: 5,
      idempotencyKey: unique("reward"),
    };
    await db().insert(pointsLedger).values(row);
    expect(
      await rejection(() =>
        db()
          .insert(pointsLedger)
          .values({ ...row, groupId: randomUUID() }),
      ),
    ).toBe("points_ledger_idempotency_key_key");
  });

  it("reward decisions: a re-evaluated event is recorded once", async () => {
    const row = {
      referralId: ctx.referral.id,
      event: "first_payment" as const,
      beneficiary: "referrer" as const,
      outcome: "granted" as const,
      idempotencyKey: unique("decision"),
    };
    await db().insert(rewardDecisions).values(row);
    expect(await rejection(() => db().insert(rewardDecisions).values(row))).toBe(
      "reward_decisions_idempotency_key_key",
    );
  });

  it("payouts: unique method key; a destination can be saved on one account only", async () => {
    const method = await newMethod();
    expect(
      await rejection(() =>
        db().insert(payoutMethods).values({ key: method.key, nameAr: "ا", nameEn: "a" }),
      ),
    ).toBe("payout_methods_key_key");
    const destination = await newDestination(ctx.user.id, method.id);
    expect(
      await rejection(() =>
        db().insert(payoutDestinations).values({
          userId: ctx.other.id,
          methodId: method.id,
          valueEnc: "v1:other",
          masked: "010••••7026",
          destinationHash: destination.destinationHash,
          usableAfter: new Date(),
        }),
      ),
    ).toBe("payout_destinations_destination_hash_key");
  });

  it("withdrawals: a request id is used once per user; a transfer reference once overall", async () => {
    const base = {
      userId: ctx.user.id,
      destinationId: ctx.destination.id,
      points: 1_000,
      amountMinor: 10_000,
      currency: "EGP",
      rateMinorPerPoint: 10,
    };
    const requestId = randomUUID();
    await db()
      .insert(withdrawalRequests)
      .values({ ...base, requestId });
    expect(
      await rejection(() =>
        db()
          .insert(withdrawalRequests)
          .values({ ...base, requestId }),
      ),
    ).toBe("withdrawal_requests_user_request_key");
    await db()
      .insert(withdrawalRequests)
      .values({ ...base, userId: ctx.other.id, requestId });

    const transferReference = unique("TRX");
    const paid = {
      ...base,
      status: "paid" as const,
      paidAt: new Date(),
      transferReference,
    };
    await db()
      .insert(withdrawalRequests)
      .values({ ...paid, requestId: randomUUID() });
    expect(
      await rejection(() =>
        db()
          .insert(withdrawalRequests)
          .values({ ...paid, requestId: randomUUID() }),
      ),
    ).toBe("withdrawal_requests_transfer_reference_key");
    await db()
      .insert(withdrawalRequests)
      .values({ ...base, requestId: randomUUID() });
    await db()
      .insert(withdrawalRequests)
      .values({ ...base, requestId: randomUUID() });
  });

  it("join links: unique slug; one limit per member", async () => {
    const slug = unique("join");
    await db().insert(organizationJoinLinks).values({ orgId: ctx.org.id, slug });
    expect(
      await rejection(() => db().insert(organizationJoinLinks).values({ orgId: ctx.org.id, slug })),
    ).toBe("organization_join_links_slug_key");

    const member = await newUser();
    await db().insert(organizationMembers).values({ orgId: ctx.org.id, userId: member.id });
    const limit = { orgId: ctx.org.id, userId: member.id, monthlyCreditCap: 50 };
    await db().insert(organizationMemberLimits).values(limit);
    expect(await rejection(() => db().insert(organizationMemberLimits).values(limit))).toBe(
      "organization_member_limits_pkey",
    );
  });
});

describe("Phase 3 rewards schema: foreign-key behaviour", () => {
  it("a program with codes or rules cannot be deleted while codes exist; its rules and tiers go with it otherwise", async () => {
    const program = await newProgram();
    await db().insert(rewardRules).values({
      programId: program.id,
      event: "renewal",
      beneficiary: "referrer",
      rewardKind: "fixed_points",
      value: 1,
      redeemableAs: "credits_only",
    });
    await db().insert(referralTiers).values({
      programId: program.id,
      key: "bronze",
      nameAr: "ا",
      nameEn: "a",
      minPaidReferrals: 0,
    });
    const code = await newCodeRow(program.id);
    expect(
      await sqlState(db().execute(sql`delete from referral_programs where id = ${program.id}`)),
    ).toBe("23001");
    await db().execute(sql`delete from referral_codes where id = ${code.id}`);
    await db().execute(sql`delete from referral_programs where id = ${program.id}`);
    expect(
      await db().select().from(rewardRules).where(eq(rewardRules.programId, program.id)),
    ).toEqual([]);
    expect(
      await db().select().from(referralTiers).where(eq(referralTiers.programId, program.id)),
    ).toEqual([]);
  });

  it("a referred or referring user cannot be deleted; points and withdrawals keep their owners", async () => {
    expect(await sqlState(db().execute(sql`delete from users where id = ${ctx.other.id}`))).toBe(
      "23001",
    );
    expect(await sqlState(db().execute(sql`delete from users where id = ${ctx.user.id}`))).toBe(
      "23001",
    );
    const wallet = await newWallet((await newUser()).id);
    expect(
      await sqlState(db().execute(sql`delete from points_wallets where id = ${wallet.id}`)),
    ).toBeUndefined();
    const ledgerWallet = await newWallet((await newUser()).id);
    await db()
      .insert(pointsLedger)
      .values({
        walletId: ledgerWallet.id,
        groupId: randomUUID(),
        kind: "admin_adjust",
        bucket: "cash",
        amount: 1,
        idempotencyKey: unique("adjust"),
      });
    expect(
      await sqlState(db().execute(sql`delete from points_wallets where id = ${ledgerWallet.id}`)),
    ).toBe("23001");
  });

  it("deleting a rule detaches its decisions and ledger rows (set null) instead of losing them", async () => {
    const rule = await one(
      db()
        .insert(rewardRules)
        .values({
          programId: ctx.program.id,
          event: "credit_pack",
          beneficiary: "referrer",
          rewardKind: "fixed_points",
          value: 1,
          redeemableAs: "credits_only",
        })
        .returning(),
    );
    const decision = await one(
      db()
        .insert(rewardDecisions)
        .values({
          referralId: ctx.referral.id,
          ruleId: rule.id,
          event: "credit_pack",
          beneficiary: "referrer",
          outcome: "granted",
          idempotencyKey: unique("decision"),
        })
        .returning(),
    );
    await db().execute(sql`delete from reward_rules where id = ${rule.id}`);
    const [kept] = await db()
      .select()
      .from(rewardDecisions)
      .where(eq(rewardDecisions.id, decision.id));
    expect(kept?.ruleId).toBeNull();
  });

  it("a deal's targets go with it; join links keep working without it; orders keep their history", async () => {
    const deal = await newDeal();
    await db()
      .insert(dealTargets)
      .values({ dealId: deal.id, targetKind: "user", targetUserId: ctx.user.id });
    const link = await one(
      db()
        .insert(organizationJoinLinks)
        .values({ orgId: ctx.org.id, slug: unique("join"), dealId: deal.id })
        .returning(),
    );
    const plan = await one(
      db()
        .insert(plans)
        .values({ key: uniqueKey("plan"), nameAr: "ا", nameEn: "a" })
        .returning(),
    );
    const order = await one(
      db()
        .insert(orders)
        .values({
          ownerUserId: ctx.user.id,
          kind: "subscription",
          planId: plan.id,
          months: 1,
          currency: "EGP",
          quote: {},
          quoteHash: HASH,
          subtotalMinor: 1,
          totalMinor: 1,
          expiresAt: new Date(Date.now() + DAY),
          dealId: deal.id,
        })
        .returning(),
    );
    await db().execute(sql`delete from deals where id = ${deal.id}`);
    expect(await db().select().from(dealTargets).where(eq(dealTargets.dealId, deal.id))).toEqual(
      [],
    );
    const [keptLink] = await db()
      .select()
      .from(organizationJoinLinks)
      .where(eq(organizationJoinLinks.id, link.id));
    expect(keptLink?.dealId).toBeNull();
    const [keptOrder] = await db().select().from(orders).where(eq(orders.id, order.id));
    expect(keptOrder?.dealId).toBeNull();
  });

  it("a member's join link can be deleted (set null); the limit follows the membership and the organization", async () => {
    const owner = await newUser();
    const org = await newOrg(owner.id);
    const member = await newUser();
    const link = await one(
      db()
        .insert(organizationJoinLinks)
        .values({ orgId: org.id, slug: unique("join") })
        .returning(),
    );
    await db()
      .insert(organizationMembers)
      .values({ orgId: org.id, userId: member.id, joinedViaLinkId: link.id });
    await db()
      .insert(organizationMemberLimits)
      .values({ orgId: org.id, userId: member.id, monthlyCreditCap: 10 });

    await db().execute(sql`delete from organization_join_links where id = ${link.id}`);
    const [membership] = await db()
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, member.id));
    expect(membership?.joinedViaLinkId).toBeNull();

    await db().execute(sql`delete from organization_members where user_id = ${member.id}`);
    expect(
      await db()
        .select()
        .from(organizationMemberLimits)
        .where(eq(organizationMemberLimits.userId, member.id)),
    ).toEqual([]);

    await db().insert(organizationMembers).values({ orgId: org.id, userId: member.id });
    await db()
      .insert(organizationMemberLimits)
      .values({ orgId: org.id, userId: member.id, monthlyCreditCap: 10 });
    await db().execute(sql`delete from organizations where id = ${org.id}`);
    expect(
      await db()
        .select()
        .from(organizationMemberLimits)
        .where(eq(organizationMemberLimits.userId, member.id)),
    ).toEqual([]);
  });

  it("organizations do not allow personal-credit fallback unless an admin says so", async () => {
    const [org] = await db().select().from(organizations).where(eq(organizations.id, ctx.org.id));
    expect(org?.allowPersonalFallback).toBe(false);
  });
});

describe("Phase 3 rewards schema: append-only grants for the API role", () => {
  it("points_ledger: INSERT and SELECT only", async () => {
    await api.db.insert(pointsLedger).values({
      walletId: ctx.wallet.id,
      groupId: randomUUID(),
      kind: "reward_pending",
      bucket: "pending",
      amount: 7,
      idempotencyKey: unique("api"),
    });
    expect((await api.db.select().from(pointsLedger)).length).toBeGreaterThan(0);
    expect(await sqlState(api.db.execute(sql`update points_ledger set amount = amount`))).toBe(
      "42501",
    );
    expect(await sqlState(api.db.execute(sql`delete from points_ledger`))).toBe("42501");
    expect(await sqlState(api.db.execute(sql`truncate points_ledger`))).toBe("42501");
  });

  it("the other reward tables stay writable (the wallet is updated with its ledger rows)", async () => {
    expect(
      await sqlState(
        api.db.execute(sql`update points_wallets set cash = cash where id = ${ctx.wallet.id}`),
      ),
    ).toBeUndefined();
  });
});
