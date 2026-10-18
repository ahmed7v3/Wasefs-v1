import { randomUUID } from "node:crypto";

import { addDays } from "@wasfa/shared/subscriptions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { activatePayment, attachCheckout, createOrder, NO_SUBSCRIPTION_HOOKS } from "../src/payments.js";
import {
  PointsLedgerError,
  ensurePointsWallet,
  pointsMove,
  reconcilePoints,
} from "../src/points-ledger.js";
import {
  attributeReferral,
  ensureReferralCode,
  renameReferralCode,
  requestSignupCheck,
} from "../src/referrals.js";
import {
  convertPointsToCredits,
  handleOrderPaid,
  handleSignupCheck,
  previewConversion,
  releaseDuePoints,
  reverseRewardsForOrder,
  type RewardDealOverrides,
} from "../src/rewards.js";
import { adminAlerts } from "../src/schema/alerts.js";
import {
  coupons,
  creditLedger,
  creditPacks,
  creditWallets,
  orders,
  outbox,
  payments,
  plans,
  pointsLedger,
  pointsWallets,
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
} from "../src/schema/index.js";
import { seedDefaults } from "../src/seed-data.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import { unique } from "./schema-kit.js";

/*
 * Points and rewards against a real PostgreSQL 18 (REFERRALS-REWARDS, Task 3.11): the ledger
 * invariants under real concurrency, rule evaluation, anti-fraud, release on a simulated clock,
 * refund reversal with the debt path, conversion and reconciliation.
 */

// The concurrency tests queue dozens of transactions on a two-connection pool.
vi.setConfig({ testTimeout: 60_000 });

let testDb: TestDb;
const db = () => testDb.handle.db;
const DAY = 86_400_000;
const T0 = new Date("2026-10-01T10:00:00Z");
let plusId: string;
let packId: string;
let seq = 0;

async function setRewards(patch: Record<string, unknown> = {}): Promise<void> {
  const value = { enabled: true, ...patch };
  await db()
    .insert(siteSettings)
    .values({ key: "rewards", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
}

beforeAll(async () => {
  testDb = await startTestDb();
  await seedDefaults(db());
  await setRewards();
  const [plus] = await db().select().from(plans).where(eq(plans.key, "plus"));
  const [pack] = await db().select().from(creditPacks).limit(1);
  if (!plus || !pack) throw new Error("seed is missing a plan or a pack");
  plusId = plus.id;
  packId = pack.id;
}, 180_000);

afterAll(async () => {
  await testDb?.stop();
});

async function newUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({ name: "Mona Ahmed", email: `${unique("rw")}@example.com`, ...values })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

/** A referrer and a referee linked through the real code and attribution functions. */
async function pair(
  refereeValues: Partial<typeof users.$inferInsert> = {},
  referrerValues: Partial<typeof users.$inferInsert> = {},
) {
  const referrerId = await newUser({ name: "Rana Referrer", ...referrerValues });
  const refereeId = await newUser({ name: "Omar Friend", ...refereeValues });
  const code = await ensureReferralCode(db(), referrerId);
  const referral = await attributeReferral(db(), {
    refereeUserId: refereeId,
    code: code.code,
    source: "code",
  });
  if (!referral) throw new Error("attribution failed");
  return { referrerId, refereeId, referral };
}

async function verify(userId: string, phone = `+2010${String(++seq).padStart(8, "0")}`) {
  await db()
    .update(users)
    .set({ emailVerified: true, phone, phoneVerified: true, phoneVerifiedAt: T0 })
    .where(eq(users.id, userId));
}

async function firstAnalysis(userId: string) {
  await db()
    .insert(rxAnalyses)
    .values({ ownerUserId: userId, createdBy: userId, status: "done", mode: "fast", skillVersion: "t@1" });
}

let orderSeq = 0;
async function paidOrder(
  userId: string,
  options: {
    kind?: "subscription" | "credit_pack";
    subtotalMinor?: number;
    paidAt?: Date;
    quote?: Record<string, unknown>;
  } = {},
) {
  const kind = options.kind ?? "subscription";
  const subtotal = options.subtotalMinor ?? 29_900;
  const [order] = await db()
    .insert(orders)
    .values({
      ownerUserId: userId,
      kind,
      planId: kind === "subscription" ? plusId : null,
      packId: kind === "credit_pack" ? packId : null,
      months: kind === "subscription" ? 1 : null,
      currency: "EGP",
      quote: options.quote ?? {},
      quoteHash: "a".repeat(64),
      subtotalMinor: subtotal,
      taxMinor: 0,
      feeMinor: 500,
      totalMinor: subtotal + 500,
      status: "paid",
      paymentKind: "gateway",
      expiresAt: addDays(T0, 30),
      paidAt: options.paidAt ?? new Date(T0.getTime() + ++orderSeq * 1_000),
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  return order;
}

async function wallet(userId: string) {
  const [row] = await db().select().from(pointsWallets).where(eq(pointsWallets.userId, userId));
  return row ?? { pending: 0, cash: 0, creditOnly: 0, lifetimeEarned: 0, id: "" };
}

async function creditBalance(userId: string): Promise<number> {
  const [row] = await db().select().from(creditWallets).where(eq(creditWallets.ownerUserId, userId));
  return row?.balance ?? 0;
}

async function expectReconciled(): Promise<void> {
  const result = await reconcilePoints(db());
  expect(result.drifted, `drifted wallets ${result.walletIds.join(",")}`).toBe(0);
}

interface PayOptions {
  deals?: RewardDealOverrides;
  /** The manual payment's sender number, as the worker would open it. */
  payer?: string;
}

const payOrder = (orderId: string, at = T0, options: PayOptions = {}) =>
  db().transaction((tx) =>
    handleOrderPaid(tx, orderId, at, {
      deals: options.deals,
      openSenderPhone: options.payer ? () => options.payer ?? null : undefined,
    }),
  );

describe("points ledger", () => {
  it("50 parallel conversions never overdraw, and credits equal points paid", async () => {
    const { referrerId } = await pair();
    const userId = referrerId;
    // 100 points of cash through the real earning path: a pending row released.
    const w = await ensurePointsWallet(db(), userId);
    await db().transaction(async (tx) => {
      await pointsMove(tx, {
        userId,
        kind: "admin_adjust",
        rows: [{ bucket: "cash", amount: 100, idempotencyKey: `seed:${w.id}` }],
        referenceType: "admin",
        referenceId: randomUUID(),
        lifetimeDelta: 100,
      });
    });

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        convertPointsToCredits(db(), { userId, points: 5, requestId: randomUUID() }),
      ),
    );
    const ok = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(ok).toHaveLength(20);
    expect(refused).toHaveLength(30);
    for (const { reason } of refused) {
      expect(reason).toBeInstanceOf(PointsLedgerError);
      expect((reason as PointsLedgerError).reason).toBe("insufficient_points");
    }
    expect((await wallet(userId)).cash).toBe(0);
    // 5 points at 5 points per credit with the +20 percent bonus is exactly 1 credit.
    expect(await creditBalance(userId)).toBe(20);
    await expectReconciled();
  });

  it("converts credit-only points first, previews the exact result and replays by request id", async () => {
    const userId = await newUser();
    await db().transaction(async (tx) => {
      await pointsMove(tx, {
        userId,
        kind: "admin_adjust",
        rows: [
          { bucket: "credit_only", amount: 30, idempotencyKey: `seed:${randomUUID()}` },
          { bucket: "cash", amount: 40, idempotencyKey: `seed:${randomUUID()}` },
        ],
        referenceType: "admin",
        referenceId: randomUUID(),
      });
    });
    const preview = await previewConversion(db(), userId, 50);
    expect(preview).toMatchObject({ credits: 12, fromCreditOnly: 30, fromCash: 20, possible: true });
    const requestId = randomUUID();
    const done = await convertPointsToCredits(db(), { userId, points: 50, requestId });
    expect(done).toEqual({ points: 50, credits: preview.credits, replayed: false });
    expect(await wallet(userId)).toMatchObject({ creditOnly: 0, cash: 20 });
    const again = await convertPointsToCredits(db(), { userId, points: 50, requestId });
    expect(again).toEqual({ points: 50, credits: 12, replayed: true });
    expect(await creditBalance(userId)).toBe(12);
    expect(await wallet(userId)).toMatchObject({ cash: 20 });
    await expect(
      convertPointsToCredits(db(), { userId, points: 21, requestId: randomUUID() }),
    ).rejects.toMatchObject({ reason: "insufficient_points" });
    await expect(
      convertPointsToCredits(db(), { userId, points: 3, requestId: randomUUID() }),
    ).rejects.toMatchObject({ reason: "below_minimum" });
    await expectReconciled();
  });

  it("refuses a conversion while a reward debt is open", async () => {
    const userId = await newUser();
    await ensurePointsWallet(db(), userId);
    await db().insert(rewardDebts).values({ userId, amount: 10, remaining: 10, reason: "test" });
    await db().transaction(async (tx) => {
      await pointsMove(tx, {
        userId,
        kind: "admin_adjust",
        rows: [{ bucket: "cash", amount: 50, idempotencyKey: `seed:${randomUUID()}` }],
        referenceType: "admin",
        referenceId: randomUUID(),
      });
    });
    await expect(
      convertPointsToCredits(db(), { userId, points: 10, requestId: randomUUID() }),
    ).rejects.toMatchObject({ reason: "open_reward_debt" });
  });

  it("reconcile flags a wallet whose bucket was edited by hand", async () => {
    const userId = await newUser();
    await ensurePointsWallet(db(), userId);
    await db().update(pointsWallets).set({ cash: 7 }).where(eq(pointsWallets.userId, userId));
    const result = await reconcilePoints(db());
    expect(result.drifted).toBe(1);
    await db().update(pointsWallets).set({ cash: 0 }).where(eq(pointsWallets.userId, userId));
    expect((await reconcilePoints(db())).drifted).toBe(0);
  });
});

describe("codes and attribution", () => {
  it("gives every user one 7-character code, once, and allows one vanity edit", async () => {
    const userId = await newUser();
    const [first, second] = await Promise.all([
      ensureReferralCode(db(), userId),
      ensureReferralCode(db(), userId),
    ]);
    expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{7}$/);
    expect(second.code).toBe(first.code);

    await expect(renameReferralCode(db(), userId, "Wasfa")).rejects.toMatchObject({ reason: "reserved_code" });
    await expect(renameReferralCode(db(), userId, "my-code")).rejects.toMatchObject({ reason: "invalid_code" });
    const renamed = await renameReferralCode(db(), userId, ` dr${String(++seq)}x `);
    expect(renamed.code).toBe(`DR${String(seq)}X`);
    expect(renamed.vanityEdited).toBe(true);
    await expect(renameReferralCode(db(), userId, "OTHER1")).rejects.toMatchObject({ reason: "vanity_used" });

    const rival = await newUser();
    await ensureReferralCode(db(), rival);
    await expect(renameReferralCode(db(), rival, renamed.code)).rejects.toMatchObject({ reason: "code_taken" });
  });

  it("first touch wins; self-referral and unknown codes are ignored", async () => {
    const a = await newUser();
    const b = await newUser();
    const referee = await newUser();
    const codeA = await ensureReferralCode(db(), a);
    const codeB = await ensureReferralCode(db(), b);
    expect(await attributeReferral(db(), { refereeUserId: a, code: codeA.code, source: "code" })).toBeNull();
    expect(await attributeReferral(db(), { refereeUserId: referee, code: "ZZZZZZZ", source: "link" })).toBeNull();
    const first = await attributeReferral(db(), { refereeUserId: referee, code: codeA.code.toLowerCase(), source: "link" });
    expect(first?.referrerUserId).toBe(a);
    expect(await attributeReferral(db(), { refereeUserId: referee, code: codeB.code, source: "code" })).toBeNull();
    const [row] = await db().select().from(referrals).where(eq(referrals.refereeUserId, referee));
    expect(row?.referrerUserId).toBe(a);
  });

  it("queues a sign-up check only for referred users, once per trigger", async () => {
    const { refereeId } = await pair();
    const stranger = await newUser();
    expect(await requestSignupCheck(db(), stranger, "email")).toBe(false);
    expect(await requestSignupCheck(db(), refereeId, "email")).toBe(true);
    await requestSignupCheck(db(), refereeId, "email");
    await requestSignupCheck(db(), refereeId, "phone");
    const rows = await db().select().from(outbox).where(eq(outbox.topic, "rewards.signup_check"));
    expect(rows.filter((row) => (row.payload as { userId: string }).userId === refereeId)).toHaveLength(2);
  });
});

describe("sign-up reward", () => {
  const check = (userId: string, at = T0) =>
    db().transaction((tx) => handleSignupCheck(tx, userId, at));

  it("pays only after email and phone are verified and a first analysis is done, and only once", async () => {
    const { referrerId, refereeId, referral } = await pair();
    expect(await check(refereeId)).toEqual([]);
    await db().update(users).set({ emailVerified: true }).where(eq(users.id, refereeId));
    expect(await check(refereeId)).toEqual([]);
    await verify(refereeId);
    expect(await check(refereeId)).toEqual([]);
    await firstAnalysis(refereeId);

    const results = await check(refereeId);
    expect(results.map((result) => [result.beneficiary, result.outcome])).toEqual([
      ["referrer", "granted"],
      ["referee", "granted"],
    ]);
    // Referrer: 50 points, credit-only after a 3 day hold. Referee: 20 welcome credits.
    expect(await wallet(referrerId)).toMatchObject({ pending: 50, cash: 0, creditOnly: 0 });
    expect(await creditBalance(refereeId)).toBe(20);
    const coupon = await db().select().from(coupons).where(eq(coupons.targetUserId, refereeId));
    expect(coupon).toHaveLength(1);
    expect(coupon[0]).toMatchObject({ kind: "percent", value: 1000, maxRedemptions: 1, status: "active" });
    const [after] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
    expect(after?.status).toBe("qualified");

    // The same event again, even in parallel, changes nothing.
    await Promise.all([check(refereeId), check(refereeId), check(refereeId)]);
    expect(await wallet(referrerId)).toMatchObject({ pending: 50 });
    expect(await creditBalance(refereeId)).toBe(20);
    expect(await db().select().from(coupons).where(eq(coupons.targetUserId, refereeId))).toHaveLength(1);
    const decisions = await db().select().from(rewardDecisions).where(eq(rewardDecisions.referralId, referral.id));
    expect(decisions).toHaveLength(2);

    // 3 days later the points become credit-only; they can never be cash.
    expect((await releaseDuePoints(db(), new Date(T0.getTime() + 2 * DAY))).released).toBe(0);
    const released = await releaseDuePoints(db(), new Date(T0.getTime() + 3 * DAY + 1));
    expect(released.released).toBe(1);
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 0, creditOnly: 50 });
    const notes = await db().select().from(userNotifications).where(eq(userNotifications.userId, referrerId));
    expect(notes.map((note) => note.kind)).toEqual(
      expect.arrayContaining(["rewards.points_earned", "rewards.points_released"]),
    );
    await expectReconciled();
  });

  it("holds both sides when the invited person shares the referrer's phone: no credits, no coupon", async () => {
    const phone = "+201088880001";
    const { refereeId, referrerId, referral } = await pair({}, { phone });
    await db()
      .update(users)
      .set({ emailVerified: true, phone, phoneVerified: true, phoneVerifiedAt: T0 })
      .where(eq(users.id, refereeId));
    await firstAnalysis(refereeId);
    const results = await check(refereeId);
    expect(results.map((result) => result.outcome)).toEqual(["held_for_review", "held_for_review"]);
    expect(await creditBalance(refereeId)).toBe(0);
    expect(await db().select().from(coupons).where(eq(coupons.targetUserId, refereeId))).toHaveLength(0);
    // The referrer's points are recorded as pending, and the hold keeps the job away from them.
    expect((await wallet(referrerId)).pending).toBe(50);
    await releaseDuePoints(db(), new Date(T0.getTime() + 30 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 50, creditOnly: 0 });
    const [row] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
    expect(row?.status).toBe("held");
  });

  it("does not wait for a first analysis when requireFirstUsage is off", async () => {
    await setRewards({ requireFirstUsage: false });
    try {
      const { refereeId, referrerId } = await pair();
      await verify(refereeId);
      expect((await check(refereeId)).length).toBe(2);
      expect((await wallet(referrerId)).pending).toBe(50);
    } finally {
      await setRewards();
    }
  });

  it("treats a phone-only account (placeholder email) as email-verified", async () => {
    const { refereeId, referrerId } = await pair({ email: `p${randomUUID()}@phone.wasfa.invalid` });
    await db().update(users).set({ phone: "+201000000999", phoneVerified: true, phoneVerifiedAt: T0 }).where(eq(users.id, refereeId));
    await firstAnalysis(refereeId);
    expect((await check(refereeId)).length).toBeGreaterThan(0);
    expect((await wallet(referrerId)).pending).toBe(50);
  });
});

describe("payments", () => {
  it("first payment: 20 percent of the net as pending points, released after 14 days on a simulated clock", async () => {
    const { referrerId, refereeId } = await pair();
    const order = await paidOrder(refereeId, { subtotalMinor: 29_900 });
    const results = await payOrder(order.id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ beneficiary: "referrer", outcome: "granted", points: 598 });
    expect(await wallet(referrerId)).toMatchObject({ pending: 598, cash: 0, lifetimeEarned: 598 });

    // The job is global (other tests' rewards are due too), so each step is judged by this wallet.
    await releaseDuePoints(db(), new Date(T0.getTime() + 13 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 598, cash: 0 });
    await releaseDuePoints(db(), new Date(T0.getTime() + 15 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 598 });
    // Releasing again pays nothing twice.
    await releaseDuePoints(db(), new Date(T0.getTime() + 30 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 598 });
    await expectReconciled();
  });

  it("uses the net: tax inside an inclusive price and fees are never rewarded", async () => {
    const { referrerId, refereeId } = await pair();
    const order = await paidOrder(refereeId, { subtotalMinor: 11_400, quote: { taxIncludedMinor: 1_400 } });
    await payOrder(order.id);
    // net 10,000 piasters = 20 percent = 2,000 piasters = 200 points.
    expect((await wallet(referrerId)).pending).toBe(200);
  });

  it("idempotent reprocessing, sequentially and in parallel, pays once", async () => {
    const { referrerId, refereeId } = await pair();
    const order = await paidOrder(refereeId);
    await Promise.all(Array.from({ length: 5 }, () => payOrder(order.id)));
    await payOrder(order.id);
    expect((await wallet(referrerId)).pending).toBe(598);
    const rows = await db()
      .select()
      .from(pointsLedger)
      .where(and(eq(pointsLedger.referenceId, order.id), eq(pointsLedger.kind, "reward_pending")));
    expect(rows).toHaveLength(1);
    const decisions = await db().select().from(rewardDecisions).where(sql`${rewardDecisions.idempotencyKey} like ${`%:${order.id}:%`}`);
    expect(decisions).toHaveLength(1);
    await expectReconciled();
  });

  it("classifies renewals and stops after max_renewals; credit packs pay 5 percent", async () => {
    const { referrerId, refereeId } = await pair();
    const amounts: number[] = [];
    for (let index = 0; index < 5; index++) {
      const order = await paidOrder(refereeId, { subtotalMinor: 10_000 });
      const [result] = await payOrder(order.id);
      amounts.push(result?.points ?? -1);
      if (index === 4) expect(result).toMatchObject({ outcome: "denied", reason: "renewals_exhausted" });
    }
    // First payment 20 percent, three renewals at 10 percent, then nothing.
    expect(amounts).toEqual([200, 100, 100, 100, 0]);
    const pack = await paidOrder(refereeId, { kind: "credit_pack", subtotalMinor: 8_000 });
    const [packResult] = await payOrder(pack.id);
    expect(packResult).toMatchObject({ outcome: "granted", points: 40 });
    expect((await wallet(referrerId)).pending).toBe(200 + 300 + 40);
  });

  it("does nothing for a user nobody referred", async () => {
    const stranger = await newUser();
    const order = await paidOrder(stranger);
    expect(await payOrder(order.id)).toEqual([]);
  });

  it("the kill switch stops accrual with a denied decision, and rewards.enabled=false does too", async () => {
    const { referrerId, refereeId, referral } = await pair();
    await setRewards({ killSwitch: true });
    try {
      const order = await paidOrder(refereeId);
      const [result] = await payOrder(order.id);
      expect(result).toMatchObject({ outcome: "denied", reason: "program_off", points: 0 });
      expect((await wallet(referrerId)).pending).toBe(0);
      const decisions = await db().select().from(rewardDecisions).where(eq(rewardDecisions.referralId, referral.id));
      expect(decisions.map((decision) => decision.reason)).toEqual(["program_off"]);
    } finally {
      await setRewards();
    }
    await setRewards({ enabled: false });
    try {
      const order = await paidOrder(refereeId);
      expect((await payOrder(order.id))[0]).toMatchObject({ reason: "program_off" });
    } finally {
      await setRewards();
    }
  });

  it("applies rule limits per referrer", async () => {
    const { referrerId } = await pair();
    const [rule] = await db()
      .select()
      .from(rewardRules)
      .where(and(eq(rewardRules.event, "credit_pack"), eq(rewardRules.beneficiary, "referrer")));
    if (!rule) throw new Error("rule missing");
    await db().update(rewardRules).set({ maxPerReferrerTotal: 1 }).where(eq(rewardRules.id, rule.id));
    try {
      // Two friends of the same referrer each buy a pack.
      const friends = [await newUser(), await newUser()];
      const code = await ensureReferralCode(db(), referrerId);
      const outcomes: string[] = [];
      for (const friend of friends) {
        await attributeReferral(db(), { refereeUserId: friend, code: code.code, source: "code" });
        const order = await paidOrder(friend, { kind: "credit_pack", subtotalMinor: 8_000 });
        outcomes.push((await payOrder(order.id))[0]?.reason ?? "none");
      }
      expect(outcomes).toEqual(["paid", "total_limit"]);
    } finally {
      await db().update(rewardRules).set({ maxPerReferrerTotal: null }).where(eq(rewardRules.id, rule.id));
    }
  });

  it("adds the tier bonus to percent rules only", async () => {
    const { referrerId, refereeId, referral } = await pair();
    await setRewards({ tiersEnabled: true });
    await db().insert(referralTiers).values({ programId: referral.programId, key: unique("silver").replaceAll("-", "_"), nameAr: "فضي", nameEn: "Silver", minPaidReferrals: 0, bonusBps: 500 }).onConflictDoNothing();
    try {
      const order = await paidOrder(refereeId, { subtotalMinor: 10_000 });
      const [result] = await payOrder(order.id);
      // 20 percent + 5 points of bonus = 25 percent of 100.00 EGP = 250 points.
      expect(result?.points).toBe(250);
      expect((await wallet(referrerId)).pending).toBe(250);
    } finally {
      await setRewards();
      await db().delete(referralTiers).where(eq(referralTiers.programId, referral.programId));
    }
  });

  it("deal overrides win over program rules", async () => {
    const { referrerId, refereeId } = await pair();
    const deals: RewardDealOverrides = {
      resolve: (_tx, query) =>
        Promise.resolve(
          query.beneficiary === "referrer" && query.event === "first_payment"
            ? {
                id: null,
                ref: "deal-test",
                rewardKind: "fixed_points",
                value: 777,
                redeemableAs: "cash_or_credits",
                holdDays: 1,
                maxPerReferrerPerDay: null,
                maxPerReferrerTotal: null,
                minOrderMinor: null,
                maxRenewals: null,
                source: "deal",
              }
            : null,
        ),
    };
    const order = await paidOrder(refereeId);
    await payOrder(order.id, T0, { deals });
    expect((await wallet(referrerId)).pending).toBe(777);
    expect((await releaseDuePoints(db(), new Date(T0.getTime() + 2 * DAY))).released).toBe(1);
    expect((await wallet(referrerId)).cash).toBe(777);
  });

  it("queues rewards.order_paid next to billing.order_paid when an order is paid", async () => {
    const userId = await newUser();
    const created = await createOrder(
      db(),
      {
        owner: { type: "user", id: userId },
        kind: "credit_pack",
        planId: null,
        packId,
        months: null,
        currency: "EGP",
        quote: { grants: { bonusCredits: 0, extraMonths: 0 } },
        quoteHash: "a".repeat(64),
        subtotalMinor: 7_900,
        discountMinor: 0,
        taxMinor: 0,
        feeMinor: 0,
        totalMinor: 7_900,
        applied: {},
        expiresAt: new Date(Date.now() + DAY),
        method: { key: "fake_card", gateway: "fake" },
      },
      NO_SUBSCRIPTION_HOOKS,
    );
    if (!created.payment) throw new Error("payment missing");
    await attachCheckout(db(), created.payment.id, `fake_${created.payment.id}`);
    await activatePayment(db(), created.payment.id, { amountMinor: 7_900, currency: "EGP" }, NO_SUBSCRIPTION_HOOKS);
    const rows = await db().select().from(outbox).where(eq(outbox.idempotencyKey, `rewards_order_paid:${created.order.id}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.topic).toBe("rewards.order_paid");
  });
});

describe("refunds", () => {
  it("reverses a pending reward", async () => {
    const { referrerId, refereeId } = await pair();
    const order = await paidOrder(refereeId);
    await payOrder(order.id);
    await db().update(orders).set({ status: "refunded" }).where(eq(orders.id, order.id));
    const result = await db().transaction((tx) => reverseRewardsForOrder(tx, order.id, T0));
    expect(result.reversed).toBe(1);
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 0, lifetimeEarned: 0 });
    // A second delivery changes nothing, and the release job never pays it.
    expect((await db().transaction((tx) => reverseRewardsForOrder(tx, order.id, T0))).reversed).toBe(0);
    await releaseDuePoints(db(), new Date(T0.getTime() + 30 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 0 });
    await expectReconciled();
  });

  it("the release job reverses instead of releasing a refunded order", async () => {
    const { referrerId, refereeId } = await pair();
    const order = await paidOrder(refereeId);
    await payOrder(order.id);
    await db().update(orders).set({ status: "refunded" }).where(eq(orders.id, order.id));
    const outcome = await releaseDuePoints(db(), new Date(T0.getTime() + 15 * DAY));
    expect(outcome.reversed).toBeGreaterThanOrEqual(1);
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 0 });
    await expectReconciled();
  });

  it("takes released points back, and records a debt for what was already spent", async () => {
    const { referrerId, refereeId } = await pair();
    const order = await paidOrder(refereeId, { subtotalMinor: 10_000 });
    await payOrder(order.id);
    await releaseDuePoints(db(), new Date(T0.getTime() + 15 * DAY));
    expect((await wallet(referrerId)).cash).toBe(200);

    // The referrer converts 150 points before the refund arrives.
    await convertPointsToCredits(db(), { userId: referrerId, points: 150, requestId: randomUUID() });
    await db().update(orders).set({ status: "refunded" }).where(eq(orders.id, order.id));
    await db().transaction((tx) => reverseRewardsForOrder(tx, order.id, T0));
    expect(await wallet(referrerId)).toMatchObject({ cash: 0, pending: 0 });
    const debts = await db().select().from(rewardDebts).where(eq(rewardDebts.userId, referrerId));
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ amount: 150, remaining: 150 });
    // Reprocessing does not double the debt.
    await db().transaction((tx) => reverseRewardsForOrder(tx, order.id, T0));
    expect(await db().select().from(rewardDebts).where(eq(rewardDebts.userId, referrerId))).toHaveLength(1);

    // The next earnings pay the debt off before anything is credited.
    const friend = await newUser();
    const code = await ensureReferralCode(db(), referrerId);
    await attributeReferral(db(), { refereeUserId: friend, code: code.code, source: "code" });
    const next = await paidOrder(friend, { subtotalMinor: 10_000 });
    const [paid] = await payOrder(next.id);
    expect(paid).toMatchObject({ outcome: "granted", points: 50 });
    const [debt] = await db().select().from(rewardDebts).where(eq(rewardDebts.userId, referrerId));
    expect(debt?.remaining).toBe(0);
    expect((await wallet(referrerId)).pending).toBe(50);
    await expectReconciled();
  });

  it("claws back credit rewards of the order", async () => {
    const { refereeId, referral } = await pair();
    const order = await paidOrder(refereeId);
    // A deal that pays the buyer bonus credits for the order.
    const deals: RewardDealOverrides = {
      resolve: (_tx, query) =>
        Promise.resolve(
          query.beneficiary === "referee" && query.event === "first_payment"
            ? {
                id: null,
                ref: "deal-credits",
                rewardKind: "fixed_credits",
                value: 15,
                redeemableAs: "credits_only",
                holdDays: 0,
                maxPerReferrerPerDay: null,
                maxPerReferrerTotal: null,
                minOrderMinor: null,
                maxRenewals: null,
                source: "deal",
              }
            : null,
        ),
    };
    await payOrder(order.id, T0, { deals });
    expect(await creditBalance(refereeId)).toBe(15);
    const result = await db().transaction((tx) => reverseRewardsForOrder(tx, order.id, T0));
    expect(result.creditsReversed).toBe(15);
    expect(await creditBalance(refereeId)).toBe(0);
    const [ledger] = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, `reward_credit:deal-credits:${referral.id}:${order.id}:referee`));
    expect(ledger?.kind).toBe("reward_bonus");
  });
});

describe("anti-fraud", () => {
  it("same phone: held, pending stays, release skips it until an admin frees the referral", async () => {
    const phone = "+201099990001";
    const { referrerId, refereeId, referral } = await pair({ phone }, { phone });
    const order = await paidOrder(refereeId);
    const [result] = await payOrder(order.id);
    expect(result).toMatchObject({ outcome: "held_for_review", reason: "held_same_phone" });
    const [held] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
    expect(held).toMatchObject({ status: "held", flags: ["same_phone"] });
    expect(held?.fraudScore).toBeGreaterThanOrEqual(50);
    expect((await wallet(referrerId)).pending).toBe(598);
    await releaseDuePoints(db(), new Date(T0.getTime() + 60 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 598, cash: 0 });

    await db().update(referrals).set({ status: "qualified" }).where(eq(referrals.id, referral.id));
    await releaseDuePoints(db(), new Date(T0.getTime() + 60 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 598 });
    await expectReconciled();
  });

  it("same device (IP and user agent, referrer session in the last 30 days) holds the reward", async () => {
    const { refereeId, referrerId, referral } = await pair();
    const device = { ipAddress: "203.0.113.9", userAgent: "TestAgent/1.0" };
    for (const [userId, token] of [
      [refereeId, randomUUID()],
      [referrerId, randomUUID()],
    ] as const) {
      await db().insert(sessions).values({ userId, token, expiresAt: addDays(T0, 30), ...device });
    }
    const order = await paidOrder(refereeId);
    const [result] = await payOrder(order.id, new Date());
    expect(result).toMatchObject({ outcome: "held_for_review", reason: "held_same_device" });
    const [row] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
    expect(row?.flags).toContain("same_device");
  });

  it("same payer: the manual payment's sender number equals the referrer's phone", async () => {
    const { refereeId, referral } = await pair({}, { phone: "+201011112222" });
    const order = await paidOrder(refereeId);
    await db().insert(payments).values({
      orderId: order.id,
      reference: `WSP-${unique("p")}`,
      methodKey: "instapay",
      status: "succeeded",
      amountMinor: order.totalMinor,
      currency: "EGP",
      senderPhoneMasked: "010*****222",
      senderPhoneEnc: "sealed",
    });
    const [result] = await payOrder(order.id, T0, { payer: "01011112222" });
    expect(result).toMatchObject({ outcome: "held_for_review", reason: "held_same_payer" });
    const [row] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
    expect(row?.flags).toContain("same_payer");
  });

  it("a fraud rule switched off in settings does not hold", async () => {
    await setRewards({ fraud: { holdSamePhone: false } });
    try {
      const phone = "+201099990002";
      const { refereeId } = await pair({ phone }, { phone });
      const order = await paidOrder(refereeId);
      expect((await payOrder(order.id))[0]).toMatchObject({ outcome: "granted" });
    } finally {
      await setRewards();
    }
  });

  it("velocity: more sign-ups per hour than allowed hold every one and raise one alert", async () => {
    await setRewards({ fraud: { velocityPerHour: 2 } });
    try {
      const referrerId = await newUser({ name: "Busy Referrer" });
      const code = await ensureReferralCode(db(), referrerId);
      const friends: string[] = [];
      for (let index = 0; index < 4; index++) {
        const friend = await newUser();
        await attributeReferral(db(), { refereeUserId: friend, code: code.code, source: "link" });
        friends.push(friend);
      }
      const before = await db().select().from(adminAlerts).where(and(eq(adminAlerts.kind, "reward.fraud_flag"), eq(adminAlerts.refId, referrerId)));
      expect(before).toHaveLength(0);
      const now = new Date();
      for (const friend of friends) {
        const order = await paidOrder(friend, { subtotalMinor: 10_000 });
        await payOrder(order.id, now);
      }
      const rows = await db().select().from(referrals).where(inArray(referrals.refereeUserId, friends));
      expect(rows.every((row) => row.status === "held" && row.flags.includes("velocity"))).toBe(true);
      const alerts = await db().select().from(adminAlerts).where(and(eq(adminAlerts.kind, "reward.fraud_flag"), eq(adminAlerts.refId, referrerId)));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.severity).toBe("warning");
      await releaseDuePoints(db(), new Date(now.getTime() + 60 * DAY));
      const pendingNow = await db()
        .select({ pending: pointsWallets.pending, cash: pointsWallets.cash })
        .from(pointsWallets)
        .where(eq(pointsWallets.userId, referrerId));
      expect(pendingNow[0]?.cash).toBe(0);
    } finally {
      await setRewards();
    }
  });

  it("the weekly budget queues rewards beyond it for review", async () => {
    await setRewards({ weeklyBudgetPoints: 1 });
    try {
      const { referrerId, refereeId, referral } = await pair();
      const order = await paidOrder(refereeId);
      const [result] = await payOrder(order.id, new Date());
      expect(result).toMatchObject({ outcome: "held_for_review", reason: "held_weekly_budget" });
      const [row] = await db().select().from(referrals).where(eq(referrals.id, referral.id));
      expect(row).toMatchObject({ status: "held" });
      expect(row?.flags).toContain("weekly_budget");
      expect((await wallet(referrerId)).pending).toBe(598);
    } finally {
      await setRewards();
    }
  });

  it("a blocked referral earns nothing and says why", async () => {
    const { refereeId, referral, referrerId } = await pair();
    await db().update(referrals).set({ status: "blocked" }).where(eq(referrals.id, referral.id));
    const order = await paidOrder(refereeId);
    expect((await payOrder(order.id))[0]).toMatchObject({ outcome: "denied", reason: "referral_blocked" });
    expect((await wallet(referrerId)).pending).toBe(0);
  });
});

describe("reconciliation after a busy day", () => {
  it("has no drift after parallel earnings, releases, reversals and conversions", async () => {
    const referrerId = await newUser({ name: "Power Referrer" });
    const code = await ensureReferralCode(db(), referrerId);
    const orderIds: string[] = [];
    for (let index = 0; index < 8; index++) {
      const friend = await newUser();
      await attributeReferral(db(), { refereeUserId: friend, code: code.code, source: "link" });
      orderIds.push((await paidOrder(friend, { subtotalMinor: 10_000 })).id);
    }
    await Promise.all(orderIds.map((id) => payOrder(id, new Date())));
    await Promise.all([
      releaseDuePoints(db(), new Date(Date.now() + 15 * DAY)),
      releaseDuePoints(db(), new Date(Date.now() + 15 * DAY)),
    ]);
    const half = orderIds.slice(0, 4);
    await db().update(orders).set({ status: "refunded" }).where(inArray(orders.id, half));
    await Promise.all([
      ...half.map((id) => db().transaction((tx) => reverseRewardsForOrder(tx, id, T0))),
      ...Array.from({ length: 10 }, () =>
        convertPointsToCredits(db(), { userId: referrerId, points: 25, requestId: randomUUID() }).catch(() => null),
      ),
    ]);
    const w = await wallet(referrerId);
    expect(w.cash).toBeGreaterThanOrEqual(0);
    expect(w.pending).toBe(0);
    await expectReconciled();
  });
});
