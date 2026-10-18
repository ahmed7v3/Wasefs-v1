import { createHash } from "node:crypto";

import { generateCouponCode } from "@wasfa/shared/coupon-codes";
import { t } from "@wasfa/shared/i18n";
import { isPlaceholderEmail } from "@wasfa/shared/identity";
import {
  REFERRAL_FRAUD_FLAGS,
  REFERRAL_TIER_WINDOW_MONTHS,
  REWARD_BENEFICIARIES,
  creditsForPoints,
  initialsOf,
  rewardEventOfReason,
  rewardPointsFor,
  type ReferralFraudFlag,
  type RewardBeneficiary,
  type RewardDecisionOutcome,
  type RewardDecisionReason,
  type RewardEvent,
  type RewardKind,
  type RewardRedeemableAs,
} from "@wasfa/shared/rewards";
import { rewardsSettingsSchema } from "@wasfa/shared/settings";
import { addDays, addMonthsClamped } from "@wasfa/shared/subscriptions";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { moveCreditsInTransaction } from "./credits-ledger.js";
import { dealRewardOverrides, designatedOrgOwner, grantMemberJoinWelcome } from "./deals.js";
import { recordGrowthEvent, serverSessionId } from "./growth.js";
import { raiseAdminAlert } from "./payments.js";
import {
  lockPointsWallet,
  offsetDebts,
  openDebtTotal,
  pointsMove,
  PointsLedgerError,
} from "./points-ledger.js";
import {
  adminAlerts,
  coupons,
  creditLedger,
  creditWallets,
  orders,
  payments,
  pointsLedger,
  pointsWallets,
  referralPrograms,
  referralTiers,
  referrals,
  rewardDebts,
  rewardDecisions,
  rewardRules,
  rxAnalyses,
  sessions,
  siteSettings,
  userNotifications,
  users,
  type Order,
  type PointsLedgerEntry,
  type Referral,
  type ReferralTier,
  type RewardDecision,
  type RewardRule,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";
import type { z } from "zod";

/*
 * Rewards (REFERRALS-REWARDS §3-§6, Task 3.11): rule resolution, limits, anti-fraud, decisions, the
 * pending bucket, release, reversal and the outbox handlers that feed them. Plain functions over a
 * transaction, shared by the worker and the API tests; every function takes `now`.
 *
 * Idempotency: a decision row carries the key `reward:<rule>:<referral>:<order|event>:<beneficiary>`
 * and is inserted before any points move, so processing the same event twice pays once. Lock order:
 * order, referral, wallet.
 */

type Handle = Database | Transaction;
export type RewardsSettings = z.output<typeof rewardsSettingsSchema>;

export async function rewardsSettingsOf(db: Handle): Promise<RewardsSettings> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, "rewards"));
  const parsed = rewardsSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : rewardsSettingsSchema.parse({});
}

// --- Rules and deals -----------------------------------------------------------------------------

/** What an evaluation needs of a rule; a deal's override has the same shape (Task 3.10). */
export interface RewardRuleLike {
  /** `reward_rules.id`; null for a deal override. */
  id: string | null;
  /** Goes into idempotency keys: the rule id, or `deal-<id>`. */
  ref: string;
  rewardKind: RewardKind;
  value: number;
  redeemableAs: RewardRedeemableAs;
  holdDays: number;
  maxPerReferrerPerDay: number | null;
  maxPerReferrerTotal: number | null;
  minOrderMinor: number | null;
  maxRenewals: number | null;
  source: "deal" | "program" | "global";
}

export interface RewardDealQuery {
  referral: Referral;
  event: RewardEvent;
  beneficiary: RewardBeneficiary;
  now: Date;
  settings: RewardsSettings;
}

/** Deals override program rules, and program rules override the global ones (REFERRALS §5). */
export interface RewardDealOverrides {
  resolve(tx: Transaction, query: RewardDealQuery): Promise<RewardRuleLike | null>;
}

/** No deal overrides at all: the program rules alone (the default is `dealRewardOverrides`). */
export const NO_DEAL_OVERRIDES: RewardDealOverrides = { resolve: () => Promise.resolve(null) };

export interface RewardEvaluationOptions {
  deals?: RewardDealOverrides | undefined;
  /** Opens the sealed sender number of a manual payment; null when it cannot be opened. */
  openSenderPhone?: ((sealed: string, paymentId: string) => string | null) | undefined;
}

const ruleLike = (rule: RewardRule, source: "program" | "global"): RewardRuleLike => ({
  id: rule.id,
  ref: rule.id,
  rewardKind: rule.rewardKind,
  value: rule.value,
  redeemableAs: rule.redeemableAs,
  holdDays: rule.holdDays,
  maxPerReferrerPerDay: rule.maxPerReferrerPerDay,
  maxPerReferrerTotal: rule.maxPerReferrerTotal,
  minOrderMinor: rule.minOrderMinor,
  maxRenewals: rule.maxRenewals,
  source,
});

async function standardProgramId(db: Handle): Promise<string | null> {
  const [row] = await db
    .select({ id: referralPrograms.id })
    .from(referralPrograms)
    .where(eq(referralPrograms.key, "standard"));
  return row?.id ?? null;
}

/** Active rules of one program that are inside their validity window, best first. */
async function activeRulesOf(db: Handle, programId: string, now: Date): Promise<RewardRule[]> {
  return db
    .select()
    .from(rewardRules)
    .where(
      and(
        eq(rewardRules.programId, programId),
        eq(rewardRules.active, true),
        or(isNull(rewardRules.validFrom), lte(rewardRules.validFrom, now)),
        or(isNull(rewardRules.validTo), gt(rewardRules.validTo, now)),
      ),
    )
    .orderBy(desc(rewardRules.priority), desc(rewardRules.createdAt), desc(rewardRules.id));
}

export type EffectiveRule = RewardRuleLike & {
  event: RewardEvent;
  beneficiary: RewardBeneficiary;
};

/**
 * The rule that applies per (event, beneficiary): the program's own, else the standard program's
 * (the global default); within a program the highest `priority` wins. Deals are layered on top by
 * the caller through `RewardDealOverrides`.
 */
export async function effectiveRules(
  db: Handle,
  programId: string,
  now: Date,
): Promise<EffectiveRule[]> {
  const own = await activeRulesOf(db, programId, now);
  const globalId = await standardProgramId(db);
  const global =
    globalId === null || globalId === programId ? [] : await activeRulesOf(db, globalId, now);
  const chosen = new Map<string, EffectiveRule>();
  const withKeys = (rule: RewardRule, source: "program" | "global"): EffectiveRule => ({
    ...ruleLike(rule, source),
    event: rule.event,
    beneficiary: rule.beneficiary,
  });
  for (const rule of global) {
    const key = `${rule.event}:${rule.beneficiary}`;
    if (!chosen.has(key)) chosen.set(key, withKeys(rule, "global"));
  }
  const seen = new Set<string>();
  for (const rule of own) {
    const key = `${rule.event}:${rule.beneficiary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.set(key, withKeys(rule, programId === globalId ? "global" : "program"));
  }
  return [...chosen.values()];
}

async function ruleFor(
  tx: Transaction,
  referral: Referral,
  event: RewardEvent,
  beneficiary: RewardBeneficiary,
  now: Date,
  deals: RewardDealOverrides,
  cache: { rules?: EffectiveRule[] },
  settings: RewardsSettings,
): Promise<RewardRuleLike | null> {
  const override = await deals.resolve(tx, { referral, event, beneficiary, now, settings });
  if (override) return override;
  cache.rules ??= await effectiveRules(tx, referral.programId, now);
  return (
    cache.rules.find((rule) => rule.event === event && rule.beneficiary === beneficiary) ?? null
  );
}

// --- Tiers ---------------------------------------------------------------------------------------

export interface TierProgress {
  paidReferrals: number;
  current: ReferralTier | null;
  next: ReferralTier | null;
}

/** Paid referrals of the last 12 months decide the tier (REFERRALS §3.4). */
export async function tierProgress(
  db: Handle,
  referrerUserId: string,
  programId: string,
  now: Date,
): Promise<TierProgress> {
  const since = addMonthsClamped(now, -REFERRAL_TIER_WINDOW_MONTHS);
  const [counted] = await db
    .select({ total: sql<number>`count(distinct ${referrals.id})::int` })
    .from(referrals)
    .innerJoin(orders, eq(orders.ownerUserId, referrals.refereeUserId))
    .where(
      and(
        eq(referrals.referrerUserId, referrerUserId),
        inArray(orders.status, ["paid", "partially_refunded"]),
        gte(orders.paidAt, since),
      ),
    );
  const paidReferrals = counted?.total ?? 0;
  let tiers = await db
    .select()
    .from(referralTiers)
    .where(and(eq(referralTiers.programId, programId), eq(referralTiers.active, true)))
    .orderBy(asc(referralTiers.minPaidReferrals));
  if (tiers.length === 0) {
    const globalId = await standardProgramId(db);
    if (globalId !== null && globalId !== programId) {
      tiers = await db
        .select()
        .from(referralTiers)
        .where(and(eq(referralTiers.programId, globalId), eq(referralTiers.active, true)))
        .orderBy(asc(referralTiers.minPaidReferrals));
    }
  }
  const reached = tiers.filter((tier) => tier.minPaidReferrals <= paidReferrals);
  return {
    paidReferrals,
    current: reached.at(-1) ?? null,
    next: tiers.find((tier) => tier.minPaidReferrals > paidReferrals) ?? null,
  };
}

// --- Fraud ---------------------------------------------------------------------------------------

export const FRAUD_FLAGS = REFERRAL_FRAUD_FLAGS;
export type FraudFlag = ReferralFraudFlag;

const FRAUD_SCORE: Record<FraudFlag, number> = {
  same_phone: 50,
  same_payer: 40,
  same_device: 30,
  velocity: 40,
  weekly_budget: 10,
};

const FLAG_REASON: Record<FraudFlag, RewardDecisionReason> = {
  same_phone: "held_same_phone",
  same_payer: "held_same_payer",
  same_device: "held_same_device",
  velocity: "held_velocity",
  weekly_budget: "held_weekly_budget",
};

const DEVICE_WINDOW_DAYS = 30;
const VELOCITY_WINDOW_MS = 3_600_000;
const WEEK_MS = 7 * 86_400_000;

/** SHA-256 of a phone's digits, with the Egyptian local form (`010...`) folded onto `2010...`. */
export function phoneHash(phone: string): string | null {
  let digits = phone.replace(/\D/gu, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `20${digits.slice(1)}`;
  return digits.length >= 8 ? createHash("sha256").update(digits).digest("hex") : null;
}

const deviceHash = (ip: string, userAgent: string) =>
  createHash("sha256").update(`${ip}|${userAgent}`).digest("hex");

async function detectFlags(
  tx: Transaction,
  referral: Referral,
  settings: RewardsSettings,
  payerPhoneHash: string | null,
  now: Date,
): Promise<FraudFlag[]> {
  const referrerId = referral.referrerUserId;
  if (referrerId === null) return [];
  const flags: FraudFlag[] = [];
  const people = await tx
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(inArray(users.id, [referrerId, referral.refereeUserId]));
  const referrer = people.find((person) => person.id === referrerId);
  const referee = people.find((person) => person.id === referral.refereeUserId);
  const referrerHash = referrer?.phone ? phoneHash(referrer.phone) : null;

  if (settings.fraud.holdSamePhone && referrerHash !== null && referee?.phone) {
    if (phoneHash(referee.phone) === referrerHash) flags.push("same_phone");
  }
  if (settings.fraud.holdSamePayer && referrerHash !== null && payerPhoneHash === referrerHash) {
    flags.push("same_payer");
  }
  if (settings.fraud.holdSameDevice) {
    const [signup] = await tx
      .select({ ip: sessions.ipAddress, userAgent: sessions.userAgent })
      .from(sessions)
      .where(eq(sessions.userId, referral.refereeUserId))
      .orderBy(asc(sessions.createdAt), asc(sessions.id))
      .limit(1);
    if (signup?.ip && signup.userAgent) {
      const wanted = deviceHash(signup.ip, signup.userAgent);
      const theirs = await tx
        .select({ ip: sessions.ipAddress, userAgent: sessions.userAgent })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, referrerId),
            gte(sessions.createdAt, addDays(now, -DEVICE_WINDOW_DAYS)),
          ),
        );
      if (theirs.some((row) => row.ip && row.userAgent && deviceHash(row.ip, row.userAgent) === wanted)) {
        flags.push("same_device");
      }
    }
  }
  const [recent] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerUserId, referrerId),
        gte(referrals.createdAt, new Date(now.getTime() - VELOCITY_WINDOW_MS)),
      ),
    );
  if ((recent?.total ?? 0) > settings.fraud.velocityPerHour) {
    flags.push("velocity");
    await holdRecentReferrals(tx, referrerId, referral.id, now);
    await raiseVelocityAlert(tx, referrerId, recent?.total ?? 0, settings.fraud.velocityPerHour, now);
  }
  return flags;
}

/**
 * "Hold all": the other recent referrals of this referrer are held too. Rows another transaction
 * is working on are skipped (no deadlock); that transaction sees the same count and holds itself.
 */
async function holdRecentReferrals(
  tx: Transaction,
  referrerId: string,
  exceptId: string,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - VELOCITY_WINDOW_MS);
  await tx.execute(sql`
    update referrals set
      status = 'held',
      flags = (select array(select distinct unnest(flags || array['velocity']::text[]))),
      fraud_score = least(fraud_score + ${FRAUD_SCORE.velocity}, 100),
      updated_at = now()
    where id in (
      select id from referrals
      where referrer_user_id = ${referrerId} and created_at >= ${since.toISOString()}::timestamptz
        and status in ('pending', 'qualified', 'rewarded') and id <> ${exceptId}
      order by id for update skip locked
    ) and not ('velocity' = any(flags))
  `);
}

async function raiseVelocityAlert(
  tx: Transaction,
  referrerId: string,
  count: number,
  limit: number,
  now: Date,
): Promise<void> {
  const [open] = await tx
    .select({ id: adminAlerts.id })
    .from(adminAlerts)
    .where(
      and(
        eq(adminAlerts.kind, "reward.fraud_flag"),
        eq(adminAlerts.refType, "referrer"),
        eq(adminAlerts.refId, referrerId),
        gte(adminAlerts.createdAt, new Date(now.getTime() - VELOCITY_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (open) return;
  await raiseAdminAlert(tx, {
    kind: "reward.fraud_flag",
    severity: "warning",
    refType: "referrer",
    refId: referrerId,
    summary: `Referral velocity: ${String(count)} sign-ups in the last hour for one referrer (limit ${String(limit)}). Rewards are held.`,
    link: "/admin/growth/fraud",
    createdAt: now,
  });
}

/** Holds the referral: status, the rule names that fired and the score. Returns the new row. */
async function holdReferral(
  tx: Transaction,
  referral: Referral,
  flags: readonly FraudFlag[],
): Promise<Referral> {
  if (referral.status === "blocked" || referral.status === "void") return referral;
  const merged = [...new Set([...referral.flags, ...flags])];
  const added = flags.filter((flag) => !referral.flags.includes(flag));
  const score = Math.min(
    100,
    referral.fraudScore + added.reduce((sum, flag) => sum + FRAUD_SCORE[flag], 0),
  );
  if (referral.status === "held" && added.length === 0) return referral;
  const [updated] = await tx
    .update(referrals)
    .set({ status: "held", flags: merged, fraudScore: score, updatedAt: sql`now()` })
    .where(eq(referrals.id, referral.id))
    .returning();
  return updated ?? referral;
}

// --- Evaluation ----------------------------------------------------------------------------------

export type RewardEventInput =
  | { event: "referee_verified"; refereeUserId: string }
  | { event: "org_member_joined"; refereeUserId: string; orgId: string }
  | {
      event: "first_payment" | "renewal" | "credit_pack";
      refereeUserId: string;
      orderId: string;
      /** The paid subtotal without tax and fees. */
      netMinor: number;
      /** 1 for the first renewal; ignored by the other events. */
      renewalNumber: number;
      /** Hash of the manual payment's sender number, when known (anti-fraud). */
      payerPhoneHash: string | null;
    };

export interface RewardEvaluation {
  beneficiary: RewardBeneficiary;
  outcome: RewardDecisionOutcome;
  reason: RewardDecisionReason;
  points: number;
  credits: number;
  ruleId: string | null;
  /** True when this decision already existed: nothing changed. */
  replayed: boolean;
}

const eventRefOf = (input: RewardEventInput): string =>
  "orderId" in input
    ? input.orderId
    : input.event === "org_member_joined"
      ? `org-${input.orgId}`
      : "verified";

const decisionKey = (rule: RewardRuleLike, referralId: string, ref: string, who: RewardBeneficiary) =>
  `reward:${rule.ref}:${referralId}:${ref}:${who}`;

const fromDecision = (row: RewardDecision, rule: RewardRuleLike): RewardEvaluation => ({
  beneficiary: row.beneficiary,
  outcome: row.outcome,
  reason: (row.reason ?? "paid") as RewardDecisionReason,
  points: row.points,
  credits: 0,
  ruleId: rule.id,
  replayed: true,
});

interface EvaluationContext {
  tx: Transaction;
  input: RewardEventInput;
  now: Date;
  settings: RewardsSettings;
  referral: Referral;
  eventRef: string;
  programOff: boolean;
  flags: FraudFlag[];
  refereeName: string | null;
}

const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Evaluates one event for the referral of `input.refereeUserId`: both sides' rules, limits, fraud
 * checks, the decision rows and the grants. Returns one result per matching rule (none when the
 * user was not referred). Never silent: every rule that matched leaves a `reward_decisions` row.
 */
export async function evaluateRewardEvent(
  tx: Transaction,
  input: RewardEventInput,
  now: Date,
  options: RewardEvaluationOptions = {},
): Promise<RewardEvaluation[]> {
  const [locked] = await tx
    .select()
    .from(referrals)
    .where(eq(referrals.refereeUserId, input.refereeUserId))
    .for("update");
  if (!locked) return [];
  let referral = locked;
  const settings = await rewardsSettingsOf(tx);
  const [program] = await tx
    .select({ active: referralPrograms.active })
    .from(referralPrograms)
    .where(eq(referralPrograms.id, referral.programId));
  const programOff = !settings.enabled || settings.killSwitch || program?.active !== true;
  const deals = options.deals ?? dealRewardOverrides;
  const eventRef = eventRefOf(input);

  const cache: { rules?: EffectiveRule[] } = {};
  const planned: Array<{ rule: RewardRuleLike; beneficiary: RewardBeneficiary }> = [];
  for (const beneficiary of REWARD_BENEFICIARIES) {
    const rule = await ruleFor(tx, referral, input.event, beneficiary, now, deals, cache, settings);
    if (rule) planned.push({ rule, beneficiary });
  }

  // A pure replay changes nothing, so it must not re-run the fraud checks either.
  const existing = planned.length
    ? await tx
        .select()
        .from(rewardDecisions)
        .where(
          inArray(
            rewardDecisions.idempotencyKey,
            planned.map(({ rule, beneficiary }) => decisionKey(rule, referral.id, eventRef, beneficiary)),
          ),
        )
    : [];
  const decided = new Map(existing.map((row) => [row.idempotencyKey, row]));

  const blocked = referral.status === "blocked" || referral.status === "void";
  let flags: FraudFlag[] = [];
  // With no rule at all the referee's coupon still needs the fraud checks before it is granted.
  const fresh =
    planned.some(
      ({ rule, beneficiary }) => !decided.has(decisionKey(rule, referral.id, eventRef, beneficiary)),
    ) ||
    (planned.length === 0 && input.event === "referee_verified");
  if (fresh && !programOff && !blocked) {
    flags = await detectFlags(
      tx,
      referral,
      settings,
      "payerPhoneHash" in input ? input.payerPhoneHash : null,
      now,
    );
    if (flags.length > 0) referral = await holdReferral(tx, referral, flags);
  }

  let refereeName: string | null = null;
  if (fresh) {
    const [row] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, referral.refereeUserId));
    refereeName = row?.name ?? null;
  }

  const results: RewardEvaluation[] = [];
  for (const { rule, beneficiary } of planned) {
    const existingDecision = decided.get(decisionKey(rule, referral.id, eventRef, beneficiary));
    if (existingDecision) {
      results.push(fromDecision(existingDecision, rule));
      continue;
    }
    const context: EvaluationContext = {
      tx,
      input,
      now,
      settings,
      referral,
      eventRef,
      programOff,
      flags,
      refereeName,
    };
    const result = await evaluateRule(context, rule, beneficiary);
    results.push(result);
    // A weekly-budget hold marks the referral too, so the fraud queue shows it.
    if (result.reason === "held_weekly_budget" && !result.replayed) {
      referral = await holdReferral(tx, referral, ["weekly_budget"]);
      context.flags.push("weekly_budget");
    }
  }

  referral = await advanceReferral(tx, referral, input.event, results, programOff);
  // Idempotent (one coupon per referral), so a replay after an admin freed a held referral grants it.
  if (input.event === "referee_verified" && !programOff && !blocked) {
    await grantRefereeCoupon(tx, referral, settings, now);
  }
  return results;
}

async function advanceReferral(
  tx: Transaction,
  referral: Referral,
  event: RewardEvent,
  results: readonly RewardEvaluation[],
  programOff: boolean,
): Promise<Referral> {
  if (programOff) return referral;
  let next: Referral["status"] | null = null;
  if (event === "referee_verified" && referral.status === "pending") next = "qualified";
  const paid = results.some((result) => result.outcome === "granted" && !result.replayed);
  if (
    paid &&
    (event === "first_payment" || event === "renewal" || event === "credit_pack") &&
    (referral.status === "pending" || referral.status === "qualified")
  ) {
    next = "rewarded";
  }
  if (next === null) return referral;
  if (next === "rewarded") {
    await recordGrowthEvent(tx, {
      name: "referral_paid",
      sessionId: serverSessionId(referral.refereeUserId, referral.id),
      userId: referral.refereeUserId,
      props: { event },
    });
  }
  const [updated] = await tx
    .update(referrals)
    .set({ status: next, updatedAt: sql`now()` })
    .where(eq(referrals.id, referral.id))
    .returning();
  return updated ?? referral;
}

async function evaluateRule(
  c: EvaluationContext,
  rule: RewardRuleLike,
  beneficiary: RewardBeneficiary,
): Promise<RewardEvaluation> {
  const { tx, input, now, settings, referral } = c;
  const key = decisionKey(rule, referral.id, c.eventRef, beneficiary);
  const base = { beneficiary, ruleId: rule.id, replayed: false, credits: 0 } as const;

  const decide = async (
    outcome: RewardDecisionOutcome,
    reason: RewardDecisionReason,
    points: number,
  ): Promise<RewardEvaluation | null> => {
    const stored = await tx
      .insert(rewardDecisions)
      .values({
        referralId: referral.id,
        ruleId: rule.id,
        event: input.event,
        beneficiary,
        outcome,
        reason,
        points,
        idempotencyKey: key,
      })
      .onConflictDoNothing({ target: rewardDecisions.idempotencyKey })
      .returning({ id: rewardDecisions.id });
    // Someone else decided the same event meanwhile (their transaction committed first).
    return stored.length === 0 ? { ...base, outcome, reason, points, replayed: true } : null;
  };
  const deny = async (reason: RewardDecisionReason): Promise<RewardEvaluation> =>
    (await decide("denied", reason, 0)) ?? { ...base, outcome: "denied", reason, points: 0 };

  if (c.programOff) return deny("program_off");
  if (referral.status === "blocked" || referral.status === "void") return deny("referral_blocked");
  let userId = beneficiary === "referrer" ? referral.referrerUserId : referral.refereeUserId;
  // An institution code has no referrer person: a deal reward goes to its designated owner.
  if (userId === null && beneficiary === "referrer" && rule.source === "deal") {
    userId = await designatedOrgOwner(tx, referral);
  }
  if (userId === null) return deny("no_referrer_user");

  const net = "netMinor" in input ? input.netMinor : 0;
  if (rule.minOrderMinor !== null && "netMinor" in input && net < rule.minOrderMinor) {
    return deny("min_order");
  }
  if (
    input.event === "renewal" &&
    "renewalNumber" in input &&
    rule.maxRenewals !== null &&
    input.renewalNumber > rule.maxRenewals
  ) {
    return deny("renewals_exhausted");
  }
  const limited = await exceedsLimit(tx, rule, referral, now);
  if (limited) return deny(limited);

  // How much: points or credits. The tier bonus only lifts a referrer's percentage rule.
  let tierBonusBps = 0;
  if (
    rule.rewardKind === "percent_of_net_bps" &&
    beneficiary === "referrer" &&
    settings.tiersEnabled &&
    referral.referrerUserId
  ) {
    const tier = await tierProgress(tx, referral.referrerUserId, referral.programId, now);
    tierBonusBps = tier.current?.bonusBps ?? 0;
  }
  const { points, credits } = rewardPointsFor(rule, net, settings, tierBonusBps);
  if (points <= 0 && credits <= 0) return deny("zero_amount");

  // Held: a fraud rule fired on this referral, it was held earlier, or the weekly budget is spent.
  let held: RewardDecisionReason | null = null;
  const firstFlag = c.flags[0];
  if (firstFlag !== undefined) held = FLAG_REASON[firstFlag];
  else if (referral.status === "held") held = "referral_held";
  if (held === null && points > 0 && settings.weeklyBudgetPoints > 0) {
    const [spent] = await tx
      .select({ total: sql<number>`coalesce(sum(${pointsLedger.amount}), 0)::int` })
      .from(pointsLedger)
      .where(
        and(
          eq(pointsLedger.kind, "reward_pending"),
          gte(pointsLedger.createdAt, new Date(now.getTime() - WEEK_MS)),
        ),
      );
    if ((spent?.total ?? 0) + points > settings.weeklyBudgetPoints) held = "held_weekly_budget";
  }

  if (credits > 0) {
    if (held !== null) {
      return (
        (await decide("held_for_review", held, 0)) ?? {
          ...base,
          outcome: "held_for_review",
          reason: held,
          points: 0,
        }
      );
    }
    const raced = await decide("granted", "paid", 0);
    if (raced) return raced;
    await moveCreditsInTransaction(
      tx,
      { type: "user", id: userId },
      {
        kind: "reward_bonus",
        amount: credits,
        idempotencyKey: `reward_credit:${rule.ref}:${referral.id}:${c.eventRef}:${beneficiary}`,
        reason: `reward:${input.event}`,
      },
    );
    await notify(tx, userId, "rewards.credits_earned", { credits, event: input.event });
    return { ...base, outcome: "granted", reason: "paid", points: 0, credits };
  }

  // Points: the user's debts absorb earnings first, under the wallet lock.
  await lockPointsWallet(tx, userId);
  const owed = Math.min(points, await openDebtTotal(tx, userId));
  const credited = points - owed;
  const outcome: RewardDecisionOutcome = held === null ? "granted" : "held_for_review";
  const reason: RewardDecisionReason = held ?? (credited === 0 ? "debt_offset" : "paid");
  const raced = await decide(outcome, reason, credited);
  if (raced) return raced;
  if (owed > 0) await offsetDebts(tx, userId, owed);
  if (credited > 0) {
    const releaseAt = addDays(now, rule.holdDays);
    await pointsMove(tx, {
      userId,
      kind: "reward_pending",
      rows: [{ bucket: "pending", amount: credited, idempotencyKey: key, releaseAt }],
      referenceType: "orderId" in input ? "order" : "referral",
      referenceId: "orderId" in input ? input.orderId : referral.id,
      ruleId: rule.id,
      reason: `${input.event}:${rule.redeemableAs}`,
      lifetimeDelta: credited,
    });
    if (held === null) {
      await notify(
        tx,
        userId,
        "rewards.points_earned",
        {
          points: credited,
          event: input.event,
          releaseAt: releaseAt.toISOString(),
          ...(beneficiary === "referrer" && c.refereeName
            ? { initials: initialsOf(c.refereeName) }
            : {}),
        },
      );
    }
  }
  return { ...base, outcome, reason, points: credited };
}

/** `daily_limit` / `total_limit` when the referrer already collected the rule's cap. */
async function exceedsLimit(
  tx: Transaction,
  rule: RewardRuleLike,
  referral: Referral,
  now: Date,
): Promise<RewardDecisionReason | null> {
  const ruleId = rule.id;
  const referrerId = referral.referrerUserId;
  if (ruleId === null || referrerId === null) return null;
  if (rule.maxPerReferrerPerDay === null && rule.maxPerReferrerTotal === null) return null;
  const count = async (since: Date | null): Promise<number> => {
    const [row] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(rewardDecisions)
      .innerJoin(referrals, eq(referrals.id, rewardDecisions.referralId))
      .where(
        and(
          eq(rewardDecisions.ruleId, ruleId),
          eq(referrals.referrerUserId, referrerId),
          inArray(rewardDecisions.outcome, ["granted", "held_for_review"]),
          since === null ? undefined : gte(rewardDecisions.createdAt, since),
        ),
      );
    return row?.total ?? 0;
  };
  if (rule.maxPerReferrerTotal !== null && (await count(null)) >= rule.maxPerReferrerTotal) {
    return "total_limit";
  }
  if (
    rule.maxPerReferrerPerDay !== null &&
    (await count(startOfUtcDay(now))) >= rule.maxPerReferrerPerDay
  ) {
    return "daily_limit";
  }
  return null;
}

async function notify(
  tx: Transaction,
  userId: string,
  kind: string,
  params: Record<string, unknown>,
): Promise<void> {
  await tx.insert(userNotifications).values({ userId, kind, params, link: "/rewards" });
}

/** REFERRALS §3.3: the invited person's private 10 percent coupon for the first purchase. */
async function grantRefereeCoupon(
  tx: Transaction,
  referral: Referral,
  settings: RewardsSettings,
  now: Date,
): Promise<void> {
  if (settings.refereeFirstPaymentDiscountBps <= 0) return;
  if (referral.status === "held" || referral.status === "blocked" || referral.status === "void") {
    return;
  }
  const campaign = `referral:${referral.id}`;
  const [already] = await tx
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.campaign, campaign), eq(coupons.targetUserId, referral.refereeUserId)));
  if (already) return;
  const endsAt = addDays(now, settings.refereeCouponValidDays);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCouponCode(8, "INV");
    const [created] = await tx
      .insert(coupons)
      .values({
        code,
        kind: "percent",
        name: campaign,
        titleAr: t("rewards.coupon.title", {}, "ar"),
        titleEn: t("rewards.coupon.title", {}, "en"),
        value: settings.refereeFirstPaymentDiscountBps,
        newCustomersOnly: true,
        startsAt: now,
        endsAt,
        maxRedemptions: 1,
        perOwnerLimit: 1,
        stacking: "exclusive",
        status: "active",
        targetUserId: referral.refereeUserId,
        campaign,
      })
      .onConflictDoNothing({ target: coupons.code })
      .returning({ id: coupons.id });
    if (!created) continue;
    await notify(
      tx,
      referral.refereeUserId,
      "rewards.coupon_ready",
      {
        code,
        percent: settings.refereeFirstPaymentDiscountBps / 100,
        expiresAt: endsAt.toISOString(),
      },
    );
    return;
  }
  throw new Error("Referee coupon code could not be generated");
}

// --- Release and reversal ------------------------------------------------------------------------

const releaseKeys = (rowId: string) => ({
  out: `release:${rowId}:out`,
  in: `release:${rowId}:in`,
});
const reverseKeys = (rowId: string) =>
  (["pending", "cash", "credit_only"] as const).map((bucket) => `reverse:${rowId}:${bucket}`);

/** The referral behind a pending row: its own reference, or the buyer of the order. */
async function referralOf(tx: Transaction, row: PointsLedgerEntry): Promise<Referral | undefined> {
  if (row.referenceType === "referral" && row.referenceId) {
    const [found] = await tx.select().from(referrals).where(eq(referrals.id, row.referenceId));
    return found;
  }
  if (row.referenceType === "order" && row.referenceId) {
    const [found] = await tx
      .select({ referral: referrals })
      .from(orders)
      .innerJoin(referrals, eq(referrals.refereeUserId, orders.ownerUserId))
      .where(eq(orders.id, row.referenceId));
    return found?.referral;
  }
  return undefined;
}

async function walletUserOf(tx: Transaction, walletId: string): Promise<string> {
  const [wallet] = await tx
    .select({ userId: pointsWallets.userId })
    .from(pointsWallets)
    .where(eq(pointsWallets.id, walletId));
  if (!wallet) throw new Error("Points wallet disappeared");
  return wallet.userId;
}

async function ledgerKeysExist(tx: Transaction, keys: readonly string[]): Promise<boolean> {
  const [found] = await tx
    .select({ id: pointsLedger.id })
    .from(pointsLedger)
    .where(inArray(pointsLedger.idempotencyKey, [...keys]))
    .limit(1);
  return found !== undefined;
}

export type ReversalCause = "refund" | "void";

/**
 * Takes one earned reward back (REFERRALS §5.4). Still pending: the pending bucket gives it up.
 * Already released: the target bucket gives up what it still holds and the rest, points already
 * spent, becomes a `reward_debts` row that future earnings offset. The wallet never goes below zero.
 * Idempotent per pending row. Returns false when the row was already released or reversed.
 */
export async function reversePendingReward(
  tx: Transaction,
  pending: PointsLedgerEntry,
  cause: ReversalCause,
  actorId: string | null = null,
): Promise<boolean> {
  const userId = await walletUserOf(tx, pending.walletId);
  const wallet = await lockPointsWallet(tx, userId);
  const [debtMarker] = await tx
    .select({ id: rewardDebts.id })
    .from(rewardDebts)
    .where(and(eq(rewardDebts.userId, userId), eq(rewardDebts.reason, `reversal:${pending.id}`)));
  if (debtMarker || (await ledgerKeysExist(tx, reverseKeys(pending.id)))) return false;

  const reason = `${cause}:${pending.reason ?? ""}`;
  const [released] = await tx
    .select()
    .from(pointsLedger)
    .where(eq(pointsLedger.idempotencyKey, releaseKeys(pending.id).in));
  const common = {
    userId,
    kind: "reward_reverse" as const,
    referenceType: pending.referenceType,
    referenceId: pending.referenceId,
    ruleId: pending.ruleId,
    reason,
    actorId,
  };
  if (!released) {
    await pointsMove(tx, {
      ...common,
      rows: [{ bucket: "pending", amount: -pending.amount, idempotencyKey: `reverse:${pending.id}:pending` }],
      lifetimeDelta: -pending.amount,
    });
    return true;
  }
  const have = released.bucket === "cash" ? wallet.cash : wallet.creditOnly;
  const take = Math.min(pending.amount, have);
  const shortfall = pending.amount - take;
  if (take > 0) {
    await pointsMove(tx, {
      ...common,
      rows: [
        {
          bucket: released.bucket,
          amount: -take,
          idempotencyKey: `reverse:${pending.id}:${released.bucket}`,
        },
      ],
      lifetimeDelta: -pending.amount,
    });
  }
  if (shortfall > 0) {
    const referral = await referralOf(tx, pending);
    await tx.insert(rewardDebts).values({
      userId,
      amount: shortfall,
      remaining: shortfall,
      reason: `reversal:${pending.id}`,
      referralId: referral?.id ?? null,
    });
    if (take === 0) {
      await tx
        .update(pointsWallets)
        .set({
          lifetimeEarned: sql`greatest(0, ${pointsWallets.lifetimeEarned} - ${pending.amount})`,
          updatedAt: sql`now()`,
        })
        .where(eq(pointsWallets.id, wallet.id));
    }
  }
  return true;
}

export interface ReversalResult {
  reversed: number;
  creditsReversed: number;
}

/** A refund: reverses every reward the order produced, points and credits. */
export async function reverseRewardsForOrder(
  tx: Transaction,
  orderId: string,
  _now: Date,
  cause: ReversalCause = "refund",
): Promise<ReversalResult> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  const result: ReversalResult = { reversed: 0, creditsReversed: 0 };
  if (!order) return result;
  if (order.ownerUserId) {
    await tx.select({ id: referrals.id }).from(referrals).where(eq(referrals.refereeUserId, order.ownerUserId)).for("update");
  }
  const rows = await tx
    .select()
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.kind, "reward_pending"),
        eq(pointsLedger.referenceType, "order"),
        eq(pointsLedger.referenceId, orderId),
      ),
    )
    .orderBy(asc(pointsLedger.createdAt), asc(pointsLedger.id));
  for (const row of rows) {
    if (await reversePendingReward(tx, row, cause)) result.reversed++;
  }

  const credited = await tx
    .select({ row: creditLedger, ownerUserId: creditWallets.ownerUserId })
    .from(creditLedger)
    .innerJoin(creditWallets, eq(creditWallets.id, creditLedger.walletId))
    .where(
      and(
        eq(creditLedger.kind, "reward_bonus"),
        sql`${creditLedger.amount} > 0`,
        sql`${creditLedger.idempotencyKey} like ${`reward_credit:%:%:${orderId}:%`}`,
      ),
    );
  for (const { row, ownerUserId } of credited) {
    if (!ownerUserId) continue;
    const moved = await moveCreditsInTransaction(
      tx,
      { type: "user", id: ownerUserId },
      {
        kind: "reward_bonus",
        amount: -row.amount,
        idempotencyKey: `reward_credit_reverse:${row.id}`,
        reason: `${cause}:reward`,
      },
    );
    if (moved && !moved.replayed) result.creditsReversed += -moved.entry.amount;
  }
  return result;
}

export interface PointsReleaseResult {
  released: number;
  reversed: number;
  /** Rows left for later: held, blocked or void referrals. */
  skipped: number;
  failed: number;
}

/**
 * The hourly job: pending rewards whose hold ended move to `cash` or `credit_only`; those of a
 * refunded order are reversed instead. Held, blocked and void referrals stay pending. Each row is
 * its own transaction, so one bad row never blocks the others.
 */
export async function releaseDuePoints(
  db: Database,
  now: Date,
  limit = 500,
): Promise<PointsReleaseResult> {
  const due = await db.execute<{ id: string }>(sql`
    select l.id
    from points_ledger l
    left join orders o on l.reference_type = 'order' and o.id = l.reference_id
    left join referrals rr on l.reference_type = 'referral' and rr.id = l.reference_id
    left join referrals ro on l.reference_type = 'order' and ro.referee_user_id = o.owner_user_id
    where l.kind = 'reward_pending' and l.release_at <= ${now.toISOString()}::timestamptz
      and coalesce(rr.status, ro.status) not in ('held', 'blocked', 'void')
      and not exists (
        select 1 from points_ledger x
        where x.idempotency_key in (
          'release:' || l.id::text || ':in',
          'reverse:' || l.id::text || ':pending',
          'reverse:' || l.id::text || ':cash',
          'reverse:' || l.id::text || ':credit_only'
        )
      )
    order by l.release_at asc, l.id asc
    limit ${limit}
  `);
  const result: PointsReleaseResult = { released: 0, reversed: 0, skipped: 0, failed: 0 };
  for (const { id } of due) {
    try {
      const outcome = await db.transaction((tx) => releaseOne(tx, id));
      result[outcome]++;
    } catch {
      // Driver messages can quote row values; the caller only needs to know that one failed.
      result.failed++;
    }
  }
  return result;
}

async function releaseOne(
  tx: Transaction,
  rowId: string,
): Promise<"released" | "reversed" | "skipped"> {
  const [pending] = await tx.select().from(pointsLedger).where(eq(pointsLedger.id, rowId));
  if (!pending) return "skipped";
  // Lock order: order, referral, wallet.
  let order: Order | undefined;
  if (pending.referenceType === "order" && pending.referenceId) {
    [order] = await tx.select().from(orders).where(eq(orders.id, pending.referenceId)).for("update");
  }
  const referral = await referralOf(tx, pending);
  if (!referral) return "skipped";
  await tx.select({ id: referrals.id }).from(referrals).where(eq(referrals.id, referral.id)).for("update");
  const [fresh] = await tx.select().from(referrals).where(eq(referrals.id, referral.id));
  if (!fresh || ["held", "blocked", "void"].includes(fresh.status)) return "skipped";

  const userId = await walletUserOf(tx, pending.walletId);
  await lockPointsWallet(tx, userId);
  if (await ledgerKeysExist(tx, [releaseKeys(pending.id).in, ...reverseKeys(pending.id)])) {
    return "skipped";
  }
  if (order && (order.status === "refunded" || order.status === "partially_refunded")) {
    return (await reversePendingReward(tx, pending, "refund")) ? "reversed" : "skipped";
  }
  const credits = pending.reason?.endsWith(":credits_only") === true;
  const target = credits ? "credit_only" : "cash";
  const keys = releaseKeys(pending.id);
  await pointsMove(tx, {
    userId,
    kind: "reward_release",
    rows: [
      { bucket: "pending", amount: -pending.amount, idempotencyKey: keys.out },
      { bucket: target, amount: pending.amount, idempotencyKey: keys.in },
    ],
    referenceType: pending.referenceType,
    referenceId: pending.referenceId,
    ruleId: pending.ruleId,
    reason: pending.reason,
  });
  await notify(
    tx,
    userId,
    "rewards.points_released",
    { points: pending.amount, event: rewardEventOfReason(pending.reason) },
  );
  return "released";
}

// --- Conversion to credits -----------------------------------------------------------------------

export interface ConversionPlan {
  points: number;
  credits: number;
  fromCreditOnly: number;
  fromCash: number;
  possible: boolean;
  reason: "insufficient_points" | "below_minimum" | "open_reward_debt" | null;
}

/** What converting `points` would do right now: the exact credits and where the points come from. */
export async function previewConversion(
  db: Handle,
  userId: string,
  points: number,
): Promise<ConversionPlan> {
  const settings = await rewardsSettingsOf(db);
  const [wallet] = await db.select().from(pointsWallets).where(eq(pointsWallets.userId, userId));
  const creditOnly = wallet?.creditOnly ?? 0;
  const cash = wallet?.cash ?? 0;
  const credits = creditsForPoints(points, settings.pointsPerCredit, settings.creditConversionBonusBps);
  const fromCreditOnly = Math.min(points, creditOnly);
  const fromCash = points - fromCreditOnly;
  let reason: ConversionPlan["reason"] = null;
  if ((await openDebtTotal(db, userId)) > 0) reason = "open_reward_debt";
  else if (fromCash > cash) reason = "insufficient_points";
  else if (credits < 1) reason = "below_minimum";
  return { points, credits, fromCreditOnly, fromCash, possible: reason === null, reason };
}

export interface ConversionResult {
  points: number;
  credits: number;
  replayed: boolean;
}

/**
 * Points to credits in one transaction: `credit_only` first, then `cash`; the points ledger
 * (`convert_to_credits`) and the credit ledger (`points_conversion`, key `points_conversion:<id>`)
 * commit together. A repeated `requestId` returns the first result. Refuses with a
 * `PointsLedgerError`: `insufficient_points`, `below_minimum`, `open_reward_debt`.
 */
export async function convertPointsToCredits(
  db: Database,
  input: { userId: string; points: number; requestId: string },
): Promise<ConversionResult> {
  return db.transaction(async (tx) => {
    const wallet = await lockPointsWallet(tx, input.userId);
    const earlier = await tx
      .select()
      .from(pointsLedger)
      .where(
        and(
          eq(pointsLedger.walletId, wallet.id),
          eq(pointsLedger.referenceType, "conversion"),
          eq(pointsLedger.referenceId, input.requestId),
        ),
      );
    if (earlier.length > 0) {
      const points = earlier.reduce((sum, row) => sum - row.amount, 0);
      const [credited] = await tx
        .select({ amount: creditLedger.amount })
        .from(creditLedger)
        .where(eq(creditLedger.idempotencyKey, `points_conversion:${input.requestId}`));
      return { points, credits: credited?.amount ?? 0, replayed: true };
    }
    const plan = await previewConversion(tx, input.userId, input.points);
    if (!plan.possible && plan.reason !== null) throw new PointsLedgerError(plan.reason);
    const rows = [
      ...(plan.fromCreditOnly > 0
        ? [
            {
              bucket: "credit_only" as const,
              amount: -plan.fromCreditOnly,
              idempotencyKey: `convert:${input.requestId}:credit_only`,
            },
          ]
        : []),
      ...(plan.fromCash > 0
        ? [
            {
              bucket: "cash" as const,
              amount: -plan.fromCash,
              idempotencyKey: `convert:${input.requestId}:cash`,
            },
          ]
        : []),
    ];
    await pointsMove(tx, {
      userId: input.userId,
      kind: "convert_to_credits",
      rows,
      referenceType: "conversion",
      referenceId: input.requestId,
      reason: "points_conversion",
    });
    await moveCreditsInTransaction(
      tx,
      { type: "user", id: input.userId },
      {
        kind: "points_conversion",
        amount: plan.credits,
        idempotencyKey: `points_conversion:${input.requestId}`,
        reason: "points_conversion",
      },
    );
    return { points: input.points, credits: plan.credits, replayed: false };
  });
}

// --- Outbox handlers -----------------------------------------------------------------------------

export const REWARD_TOPICS = {
  signupCheck: "rewards.signup_check",
  orderPaid: "rewards.order_paid",
  orderRefunded: "rewards.order_refunded",
  memberJoined: "orgs.member_joined",
} as const;

/** The paid subtotal of an order without tax and fees (inclusive tax is taken out of the subtotal). */
export function netPaidMinor(order: Pick<Order, "subtotalMinor" | "quote">): number {
  const included = Number((order.quote as { taxIncludedMinor?: unknown }).taxIncludedMinor ?? 0);
  return Math.max(0, order.subtotalMinor - (Number.isSafeInteger(included) ? included : 0));
}

/**
 * `rewards.signup_check`: pays the sign-up rules once the person has verified email and phone and,
 * when `requireFirstUsage` is on, finished a first analysis. Phone-only accounts have a placeholder
 * email that can never be verified, so for them the verified phone is the whole condition.
 */
export async function handleSignupCheck(
  tx: Transaction,
  userId: string,
  now: Date,
  options: RewardEvaluationOptions = {},
): Promise<RewardEvaluation[]> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  if (!user || user.status !== "active") return [];
  const emailOk = user.emailVerified || isPlaceholderEmail(user.email);
  if (!emailOk || user.phoneVerifiedAt === null) return [];
  const settings = await rewardsSettingsOf(tx);
  if (settings.requireFirstUsage) {
    const [done] = await tx
      .select({ id: rxAnalyses.id })
      .from(rxAnalyses)
      .where(and(eq(rxAnalyses.ownerUserId, userId), eq(rxAnalyses.status, "done")))
      .limit(1);
    if (!done) return [];
  }
  return evaluateRewardEvent(tx, { event: "referee_verified", refereeUserId: userId }, now, options);
}

const COUNTED_ORDER_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

/** `rewards.order_paid`: classifies the order (credit pack, first payment, renewal) and evaluates it. */
export async function handleOrderPaid(
  tx: Transaction,
  orderId: string,
  now: Date,
  options: RewardEvaluationOptions = {},
): Promise<RewardEvaluation[]> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order?.ownerUserId || order.paidAt === null) return [];
  if (order.status === "refunded" || order.totalMinor === 0) return [];
  const netMinor = netPaidMinor(order);

  const before = and(
    eq(orders.ownerUserId, order.ownerUserId),
    inArray(orders.status, [...COUNTED_ORDER_STATUSES]),
    gt(orders.totalMinor, 0),
    or(
      lt(orders.paidAt, order.paidAt),
      and(eq(orders.paidAt, order.paidAt), lt(orders.id, order.id)),
    ),
  );
  let event: "first_payment" | "renewal" | "credit_pack";
  let renewalNumber = 1;
  if (order.kind === "credit_pack") {
    event = "credit_pack";
  } else {
    const [earlier] = await tx
      .select({
        subscriptions: sql<number>`(count(*) filter (where ${orders.kind} in ('subscription', 'upgrade')))::int`,
      })
      .from(orders)
      .where(before);
    // Credit packs have their own event: a pack bought first does not turn the first subscription
    // payment into a "renewal".
    const earlierSubscriptions = earlier?.subscriptions ?? 0;
    if (earlierSubscriptions === 0) {
      event = "first_payment";
    } else {
      event = "renewal";
      renewalNumber = earlierSubscriptions;
    }
  }

  let payerPhoneHash: string | null = null;
  if (options.openSenderPhone) {
    const [manual] = await tx
      .select({ id: payments.id, sealed: payments.senderPhoneEnc })
      .from(payments)
      .where(and(eq(payments.orderId, order.id), sql`${payments.senderPhoneEnc} is not null`))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    if (manual?.sealed) {
      const phone = options.openSenderPhone(manual.sealed, manual.id);
      payerPhoneHash = phone ? phoneHash(phone) : null;
    }
  }
  return evaluateRewardEvent(
    tx,
    { event, refereeUserId: order.ownerUserId, orderId: order.id, netMinor, renewalNumber, payerPhoneHash },
    now,
    options,
  );
}

/** `rewards.order_refunded`. */
export async function handleOrderRefunded(
  tx: Transaction,
  orderId: string,
  now: Date,
): Promise<ReversalResult> {
  return reverseRewardsForOrder(tx, orderId, now, "refund");
}

/** `orgs.member_joined`: the member's referral (if any) earns the organization-join rules. */
export async function handleMemberJoined(
  tx: Transaction,
  input: { orgId: string; userId: string },
  now: Date,
  options: RewardEvaluationOptions = {},
): Promise<RewardEvaluation[]> {
  // The deal that brought the member in pays its welcome credits (once per deal and person).
  await grantMemberJoinWelcome(tx, input, now);
  return evaluateRewardEvent(
    tx,
    { event: "org_member_joined", refereeUserId: input.userId, orgId: input.orgId },
    now,
    options,
  );
}
