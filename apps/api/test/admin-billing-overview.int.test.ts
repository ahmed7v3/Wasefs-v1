import { randomUUID } from "node:crypto";

import {
  aiUsage,
  coupons,
  creditLedger,
  creditWallets,
  growthEvents,
  orders,
  payoutDestinations,
  payoutMethods,
  pointsLedger,
  pointsWallets,
  promotions,
  referralCodes,
  referralPrograms,
  referrals,
  refunds,
  subscriptions,
  withdrawalRequests,
} from "@wasfa/db";
import { AI_OUTCOMES, AI_TASKS } from "@wasfa/shared/ai";
import {
  adminCountsResponseSchema,
  adminOverviewResponseSchema,
} from "@wasfa/shared/schemas/admin-billing-console";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";
import { insertOrder, insertPayment, planIdOf } from "./support/billing-console-fixtures.js";

import type { Order } from "@wasfa/db";

/*
 * The billing overview and the sidebar counters (Task 3.8). The data is placed in a fixed window
 * in the past so every figure is exact: two currencies are never added, the previous period is the
 * window of equal length just before, and the second call inside a minute is served from Redis.
 */

const ctx = new AdminTestContext();
let boss: Admin;

const at = (date: string, time = "12:00:00") => new Date(`${date}T${time}.000Z`);
const DAY = 86_400_000;
const WINDOW = "range=custom&from=2025-03-08T00:00:00.000Z&to=2025-03-15T00:00:00.000Z";

let sub: { b: string; e: string };

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  const db = ctx.owner.db;

  const names = ["Amira", "Basel", "Carla", "Dina", "Emad"] as const;
  const [a, b, c, d, e] = await Promise.all(
    names.map((name) =>
      ctx.insertUser({ name, email: `${name.toLowerCase()}.overview@example.com` }),
    ),
  );
  if (!a || !b || !c || !d || !e) throw new Error("user setup failed");

  // --- Current window: 2025-03-08 .. 2025-03-15 ------------------------------------------------
  const o1 = await insertOrder(ctx, {
    ownerUserId: a,
    planKey: "plus",
    months: 3,
    subtotalMinor: 10_000,
    paidAt: at("2025-03-10"),
    applied: {},
  });
  const o2 = await insertOrder(ctx, {
    ownerUserId: b,
    planKey: "pro",
    subtotalMinor: 20_000,
    status: "partially_refunded",
    paidAt: at("2025-03-11"),
  });
  await insertOrder(ctx, {
    ownerUserId: c,
    kind: "credit_pack",
    currency: "USD",
    subtotalMinor: 1_500,
    paidAt: at("2025-03-12"),
  });
  const o4 = await insertOrder(ctx, {
    ownerUserId: a,
    kind: "credit_pack",
    subtotalMinor: 2_000,
    paidAt: at("2025-03-13"),
  });
  // Not paid: never counted.
  await insertOrder(ctx, { ownerUserId: d, subtotalMinor: 9_999, status: "pending_payment" });

  // --- Previous window: 2025-03-01 .. 2025-03-08 -----------------------------------------------
  await insertOrder(ctx, {
    ownerUserId: c,
    currency: "USD",
    subtotalMinor: 3_000,
    paidAt: at("2025-03-03"),
  });
  const o6 = await insertOrder(ctx, {
    ownerUserId: d,
    subtotalMinor: 8_000,
    status: "refunded",
    paidAt: at("2025-03-04"),
  });

  const p2 = await insertPayment(ctx, { order: o2, status: "partially_refunded" });
  const p6 = await insertPayment(ctx, { order: o6, status: "refunded" });
  await db.insert(refunds).values([
    {
      paymentId: p2.id,
      amountMinor: 5_000,
      currency: "EGP",
      reason: "partial",
      status: "succeeded",
      createdAt: at("2025-03-12"),
    },
    {
      paymentId: p6.id,
      amountMinor: 8_000,
      currency: "EGP",
      reason: "full",
      status: "succeeded",
      createdAt: at("2025-03-05"),
    },
    // Asked for but not paid out: not a refund yet.
    {
      paymentId: p2.id,
      amountMinor: 1_000,
      currency: "EGP",
      reason: "pending",
      status: "approved",
      createdAt: at("2025-03-12"),
    },
  ]);

  // --- Live subscriptions (MRR is "as of now"; B and E end soon) -------------------------------
  const live = (
    ownerUserId: string,
    planId: string,
    lastOrderId: Order["id"] | null,
    days: number,
  ) =>
    db
      .insert(subscriptions)
      .values({
        ownerUserId,
        planId,
        status: "active",
        source: "paid",
        currentPeriodStart: new Date(Date.now() - 20 * DAY),
        currentPeriodEnd: new Date(Date.now() + days * DAY),
        lastOrderId,
      })
      .returning({ id: subscriptions.id });
  await live(a, await planIdOf(ctx, "plus"), o1.id, 60);
  const [subB] = await live(b, await planIdOf(ctx, "pro"), o2.id, 2);
  const [subE] = await live(e, await planIdOf(ctx, "plus"), null, 1);
  sub = { b: subB?.id ?? "", e: subE?.id ?? "" };

  // --- Credits, AI cost, points ----------------------------------------------------------------
  const [wallet] = await db
    .insert(creditWallets)
    .values({ ownerUserId: a, balance: 500 })
    .returning();
  let ledgerNo = 0;
  const ledger = (kind: "purchase" | "usage_settle", amount: number, day: string) => ({
    walletId: wallet?.id ?? "",
    kind,
    amount,
    balanceAfter: 500,
    idempotencyKey: `overview-${String(++ledgerNo)}`,
    createdAt: at(day),
  });
  await db
    .insert(creditLedger)
    .values([
      ledger("purchase", 100, "2025-03-10"),
      ledger("usage_settle", -7, "2025-03-11"),
      ledger("usage_settle", -3, "2025-03-13"),
      ledger("purchase", 300, "2025-03-04"),
      ledger("usage_settle", -2, "2025-03-05"),
    ]);
  const usage = (costUsdMicros: number, day: string) => ({
    task: AI_TASKS[0],
    modelKey: "m",
    outcome: AI_OUTCOMES[0],
    costUsdMicros,
    creditsCharged: 1,
    createdAt: at(day),
  });
  await db
    .insert(aiUsage)
    .values([
      usage(150_000, "2025-03-10"),
      usage(50_000, "2025-03-12"),
      usage(70_000, "2025-03-02"),
    ]);

  const [points] = await db.insert(pointsWallets).values({ userId: a }).returning();
  let pointsNo = 0;
  const entry = (kind: "reward_pending" | "withdraw_paid", amount: number, day: string) => ({
    walletId: points?.id ?? "",
    groupId: randomUUID(),
    kind,
    bucket: kind === "reward_pending" ? ("pending" as const) : ("cash" as const),
    amount,
    idempotencyKey: `overview-points-${String(++pointsNo)}`,
    createdAt: at(day),
  });
  await db
    .insert(pointsLedger)
    .values([
      entry("reward_pending", 50, "2025-03-10"),
      entry("reward_pending", 20, "2025-03-11"),
      entry("withdraw_paid", -40, "2025-03-12"),
      entry("reward_pending", 30, "2025-03-02"),
    ]);

  // --- Discounts: used by orders, near their limit, ending soon --------------------------------
  const [coupon] = await db
    .insert(coupons)
    .values({
      code: "SAVE10",
      kind: "percent",
      name: "Save",
      titleAr: "وفر",
      titleEn: "Save",
      value: 1_000,
      status: "active",
    })
    .returning();
  const [promotion] = await db
    .insert(promotions)
    .values({
      kind: "percent",
      name: "Spring sale",
      titleAr: "عرض",
      titleEn: "Sale",
      value: 2_000,
      status: "active",
      endsAt: new Date(Date.now() + DAY),
    })
    .returning();
  await db.insert(promotions).values({
    kind: "percent",
    name: "Long sale",
    titleAr: "عرض",
    titleEn: "Long",
    value: 500,
    status: "active",
    endsAt: new Date(Date.now() + 5 * DAY),
  });
  await db.insert(coupons).values([
    {
      code: "NEARFULL",
      kind: "percent",
      name: "Near",
      titleAr: "ن",
      titleEn: "Near",
      value: 500,
      status: "active",
      maxRedemptions: 10,
      redeemedCount: 8,
    },
    {
      code: "PLENTY",
      kind: "percent",
      name: "Plenty",
      titleAr: "ك",
      titleEn: "Plenty",
      value: 500,
      status: "active",
      maxRedemptions: 10,
      redeemedCount: 7,
    },
  ]);
  await db
    .update(orders)
    .set({ applied: { couponId: coupon?.id } })
    .where(eq(orders.id, o1.id));
  await db
    .update(orders)
    .set({ applied: { couponId: coupon?.id } })
    .where(eq(orders.id, o4.id));
  await db
    .update(orders)
    .set({ applied: { promotionId: promotion?.id } })
    .where(eq(orders.id, o2.id));

  // --- Funnel -----------------------------------------------------------------------------------
  const event = (
    name: "pricing_viewed" | "checkout_started" | "payment_succeeded",
    sessionId: string,
    day: string,
    methodKey?: string,
  ) => ({
    name,
    sessionId,
    occurredAt: at(day),
    props: methodKey ? { methodKey } : {},
  });
  await db.insert(growthEvents).values([
    event("pricing_viewed", "session-aaaa-1", "2025-03-09"),
    event("pricing_viewed", "session-aaaa-1", "2025-03-09"),
    event("pricing_viewed", "session-aaaa-2", "2025-03-10"),
    event("pricing_viewed", "session-aaaa-3", "2025-03-11"),
    event("checkout_started", "session-aaaa-1", "2025-03-09", "instapay"),
    event("checkout_started", "session-aaaa-2", "2025-03-10", "fake_card"),
    event("payment_succeeded", "session-aaaa-1", "2025-03-09", "instapay"),
    // Outside the window.
    event("pricing_viewed", "session-aaaa-9", "2025-03-01"),
  ]);

  // --- Waiting work: manual payments, failures, withdrawals, fraud holds ------------------------
  const waiting = async (
    status: "awaiting_review" | "awaiting_second_approval" | "failed",
    ageMinutes: number,
    methodKey: string,
    failureCode?: string,
  ) => {
    const owner = await ctx.insertUser({
      name: "Waiter",
      email: `${randomUUID().slice(0, 8)}@example.com`,
    });
    const order = await insertOrder(ctx, {
      ownerUserId: owner,
      subtotalMinor: 1_000,
      status: "pending_payment",
    });
    const when = new Date(Date.now() - ageMinutes * 60_000);
    await insertPayment(ctx, {
      order,
      status,
      methodKey,
      createdAt: when,
      updatedAt: when,
      ...(failureCode ? { failureCode } : {}),
    });
  };
  // The default review window is 120 minutes; vodafone_cash gets a stricter 5.
  await db.execute(
    sql`update payment_methods set review_sla_minutes = 5 where key = 'vodafone_cash'`,
  );
  await waiting("awaiting_review", 180, "instapay");
  await waiting("awaiting_review", 10, "instapay");
  await waiting("awaiting_second_approval", 20, "vodafone_cash");
  await waiting("failed", 30, "instapay");
  await waiting("failed", 60, "instapay", "amount_mismatch");
  await waiting("failed", 3 * 24 * 60, "instapay");

  const [method] = await db
    .insert(payoutMethods)
    .values({ key: "overview_payout", nameAr: "ا", nameEn: "a" })
    .returning();
  const [destination] = await db
    .insert(payoutDestinations)
    .values({
      userId: a,
      methodId: method?.id ?? "",
      valueEnc: "v1:sealed",
      masked: "010••••7026",
      destinationHash: "b".repeat(64),
      usableAfter: new Date(),
    })
    .returning();
  const withdrawal = (status: "requested" | "approved", minutes: number) => ({
    userId: a,
    requestId: randomUUID(),
    destinationId: destination?.id ?? "",
    points: 1_000,
    amountMinor: 10_000,
    currency: "EGP",
    rateMinorPerPoint: 10,
    status,
    createdAt: new Date(Date.now() - minutes * 60_000),
  });
  await db
    .insert(withdrawalRequests)
    .values([
      withdrawal("requested", 300),
      withdrawal("requested", 60),
      withdrawal("approved", 600),
    ]);

  const [program] = await db
    .insert(referralPrograms)
    .values({ key: "overview_prog", kind: "standard", nameAr: "ب", nameEn: "P" })
    .returning();
  const [code] = await db
    .insert(referralCodes)
    .values({ code: "OVERVIEWREF", kind: "campaign", programId: program?.id ?? "" })
    .returning();
  for (const status of ["held", "held", "qualified"] as const) {
    const referee = await ctx.insertUser({
      name: "Referee",
      email: `${randomUUID().slice(0, 8)}@example.com`,
    });
    await db.insert(referrals).values({
      refereeUserId: referee,
      codeId: code?.id ?? "",
      programId: program?.id ?? "",
      status,
    });
  }
}, 180_000);

afterAll(async () => ctx.stop());

const overview = async (query: string, who: { jar: Admin["jar"] } = boss) => {
  const response = await ctx.harness.call("GET", `/admin/billing/overview?${query}`, {
    jar: who.jar,
  });
  expect(response.statusCode, response.body).toBe(200);
  return adminOverviewResponseSchema.parse(response.json());
};
const clearCache = async () => {
  const keys = await ctx.redis.keys("admin:billing:overview:*");
  if (keys.length > 0) await ctx.redis.del(...keys);
};

describe("GET /admin/billing/overview", () => {
  it("sums each currency on its own for the window and for the one before it", async () => {
    const result = await overview(WINDOW);
    expect(result.range).toEqual({
      from: "2025-03-08T00:00:00.000Z",
      to: "2025-03-15T00:00:00.000Z",
    });
    expect(result.kpis).toEqual({
      revenueNetMinor: { EGP: 32_000, USD: 1_500 },
      refundsMinor: { EGP: 5_000 },
      orders: 4,
      newPaidSubscribers: 2,
      // A: floor(10,000 / 3 months) + B: 20,000 / 1 month, both live and paid.
      mrrMinor: { EGP: 23_333 },
      arpuMinor: { EGP: 16_000, USD: 1_500 },
      refundRateBps: 2_500,
      aiCostUsdMicros: 200_000,
      creditsSold: 100,
      creditsConsumed: 10,
      rewardsAccruedPoints: 70,
      rewardsPaidPoints: 40,
    });
    expect(result.previous).toEqual({
      revenueNetMinor: { EGP: 8_000, USD: 3_000 },
      refundsMinor: { EGP: 8_000 },
      orders: 2,
      newPaidSubscribers: 2,
      mrrMinor: { EGP: 23_333 },
      arpuMinor: { EGP: 8_000, USD: 3_000 },
      refundRateBps: 5_000,
      aiCostUsdMicros: 70_000,
      creditsSold: 300,
      creditsConsumed: 2,
      rewardsAccruedPoints: 30,
      rewardsPaidPoints: 0,
    });
  });

  it("breaks the window down by plan, discount and funnel step", async () => {
    const result = await overview(WINDOW);
    expect(result.planMix).toHaveLength(4);
    expect(result.planMix).toEqual(
      expect.arrayContaining([
        { planKey: "pro", currency: "EGP", orders: 1, amountMinor: 20_000 },
        { planKey: "plus", currency: "EGP", orders: 1, amountMinor: 10_000 },
        { planKey: null, currency: "EGP", orders: 1, amountMinor: 2_000 },
        { planKey: null, currency: "USD", orders: 1, amountMinor: 1_500 },
      ]),
    );
    expect(result.topDiscounts.coupons).toEqual([
      { id: expect.any(String), name: "SAVE10", currency: "EGP", revenueMinor: 12_000 },
    ]);
    expect(result.topDiscounts.promotions).toEqual([
      { id: expect.any(String), name: "Spring sale", currency: "EGP", revenueMinor: 20_000 },
    ]);
    expect(result.funnel).toHaveLength(6);
    expect(result.funnel).toEqual(
      expect.arrayContaining([
        { step: "pricing_viewed", methodKey: null, sessions: 3 },
        { step: "checkout_started", methodKey: null, sessions: 2 },
        { step: "payment_succeeded", methodKey: null, sessions: 1 },
        { step: "checkout_started", methodKey: "instapay", sessions: 1 },
        { step: "checkout_started", methodKey: "fake_card", sessions: 1 },
        { step: "payment_succeeded", methodKey: "instapay", sessions: 1 },
      ]),
    );
  });

  it("lists what needs attention, with the contact of customers masked", async () => {
    const { attention } = await overview(WINDOW);
    expect(attention.manualPaymentsWaiting.count).toBe(3);
    // The 3-hour-old instapay payment is past the 120-minute default, the 20-minute vodafone one
    // past its own 5; the 10-minute instapay payment is within its window.
    expect(attention.manualPaymentsWaiting.overdueCount).toBe(2);
    expect(attention.manualPaymentsWaiting.oldestSeconds).toBeGreaterThanOrEqual(10_800);
    expect(attention.manualPaymentsWaiting.oldestSeconds).toBeLessThan(10_900);
    expect(attention.withdrawalsWaiting.count).toBe(2);
    expect(attention.withdrawalsWaiting.oldestSeconds).toBeGreaterThanOrEqual(18_000);
    expect(attention.withdrawalsWaiting.oldestSeconds).toBeLessThan(18_100);
    expect(attention.fraudHolds).toBe(2);
    // Failed or mismatched within a day: the old failure is out.
    expect(attention.failedOrMismatchPayments24h).toBe(2);

    expect(attention.subscriptionsEnding).toEqual([
      {
        id: sub.b,
        ownerLabel: "B***",
        planKey: "pro",
        periodEnd: expect.any(String),
        subtotalMinor: 20_000,
      },
      {
        id: sub.e,
        ownerLabel: "E***",
        planKey: "plus",
        periodEnd: expect.any(String),
        subtotalMinor: null,
      },
    ]);
    expect(attention.promotionsEnding).toEqual([
      { id: expect.any(String), name: "Spring sale", endsAt: expect.any(String) },
    ]);
    expect(attention.couponsNearLimit).toEqual([
      { id: expect.any(String), code: "NEARFULL", redeemed: 8, max: 10 },
    ]);
    const body = JSON.stringify(attention);
    expect(body).not.toContain("Basel");
    expect(body).not.toContain("@example.com");
  });

  it("serves the second call from the cache for a minute", async () => {
    await clearCache();
    const first = await overview(WINDOW);
    // New paid revenue inside the window is invisible until the entry expires.
    const owner = await ctx.insertUser({ name: "Late Buyer", email: "late.buyer@example.com" });
    await insertOrder(ctx, { ownerUserId: owner, subtotalMinor: 777, paidAt: at("2025-03-14") });
    const second = await overview(WINDOW);
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.kpis.revenueNetMinor.EGP).toBe(32_000);

    const keys = await ctx.redis.keys("admin:billing:overview:*");
    expect(keys).toEqual([
      "admin:billing:overview:custom:2025-03-08T00:00:00.000Z:2025-03-15T00:00:00.000Z",
    ]);
    expect(await ctx.redis.ttl(keys[0] ?? "")).toBeGreaterThan(0);
    expect(await ctx.redis.ttl(keys[0] ?? "")).toBeLessThanOrEqual(60);

    await clearCache();
    const fresh = await overview(WINDOW);
    expect(fresh.generatedAt).not.toBe(first.generatedAt);
    expect(fresh.kpis.revenueNetMinor.EGP).toBe(32_777);
  });

  it("answers the preset ranges, each cached under its own key", async () => {
    await clearCache();
    for (const [range, days] of [
      ["7d", 7],
      ["30d", 30],
    ] as const) {
      const result = await overview(`range=${range}`);
      const span = new Date(result.range.to).getTime() - new Date(result.range.from).getTime();
      expect(span).toBe(days * DAY);
    }
    const today = await overview("range=today");
    expect(today.range.from.endsWith("T00:00:00.000Z")).toBe(true);
    const fallback = await overview("");
    expect(new Date(fallback.range.to).getTime() - new Date(fallback.range.from).getTime()).toBe(
      30 * DAY,
    );
    const keys = (await ctx.redis.keys("admin:billing:overview:*")).sort();
    expect(keys).toEqual([
      "admin:billing:overview:30d::",
      "admin:billing:overview:7d::",
      "admin:billing:overview:today::",
    ]);
  });

  it("rejects an incomplete, reversed or too long custom range and an unknown range", async () => {
    const bad = [
      "range=custom",
      "range=custom&from=2025-03-01T00:00:00.000Z",
      "range=custom&from=2025-03-10T00:00:00.000Z&to=2025-03-01T00:00:00.000Z",
      "range=custom&from=2025-03-01T00:00:00.000Z&to=2025-03-01T00:00:00.000Z",
      "range=custom&from=2024-01-01T00:00:00.000Z&to=2025-03-01T00:00:00.000Z",
      "range=custom&from=nonsense&to=2025-03-01T00:00:00.000Z",
      "range=forever",
    ];
    for (const query of bad) {
      const response = await ctx.harness.call("GET", `/admin/billing/overview?${query}`, {
        jar: boss.jar,
      });
      expect(response.statusCode, query).toBe(400);
    }
    // 366 days is the longest allowed.
    const longest = await ctx.harness.call(
      "GET",
      "/admin/billing/overview?range=custom&from=2024-03-01T00:00:00.000Z&to=2025-03-02T00:00:00.000Z",
      { jar: boss.jar },
    );
    expect(longest.statusCode, longest.body).toBe(200);
  });

  it("is empty but well formed for a window without any activity", async () => {
    const result = await overview(
      "range=custom&from=2020-01-01T00:00:00.000Z&to=2020-01-08T00:00:00.000Z",
    );
    expect(result.kpis).toMatchObject({
      revenueNetMinor: {},
      refundsMinor: {},
      orders: 0,
      newPaidSubscribers: 0,
      arpuMinor: {},
      refundRateBps: 0,
      aiCostUsdMicros: 0,
      creditsSold: 0,
      creditsConsumed: 0,
    });
    expect(result.planMix).toEqual([]);
    expect(result.topDiscounts).toEqual({ coupons: [], promotions: [] });
    expect(result.funnel.map((row) => row.sessions)).toEqual([0, 0, 0]);
  });
});

describe("GET /admin/billing/counts", () => {
  const counts = async (who: { jar: Admin["jar"] }) => {
    const response = await ctx.harness.call("GET", "/admin/billing/counts", { jar: who.jar });
    expect(response.statusCode, response.body).toBe(200);
    return adminCountsResponseSchema.parse(response.json());
  };

  it("counts only the work that still needs a decision", async () => {
    // Two requested withdrawals (the approved one waits for the payout), three payments in review,
    // two referrals held.
    expect(await counts(boss)).toEqual({
      paymentsToReview: 3,
      withdrawalsToReview: 2,
      fraudHolds: 2,
    });
  });

  it("hides the counters the caller may not see", async () => {
    const payments = await ctx.admin(await ctx.customRole(["payments.review"]));
    expect(await counts(payments)).toEqual({
      paymentsToReview: 3,
      withdrawalsToReview: null,
      fraudHolds: null,
    });
    const withdrawals = await ctx.admin(await ctx.customRole(["withdrawals.review"]));
    expect(await counts(withdrawals)).toEqual({
      paymentsToReview: null,
      withdrawalsToReview: 2,
      fraudHolds: null,
    });
    const referralsReader = await ctx.admin(await ctx.customRole(["referrals.read"]));
    expect(await counts(referralsReader)).toEqual({
      paymentsToReview: null,
      withdrawalsToReview: null,
      fraudHolds: 2,
    });
  });

  it("refuses a caller with none of the three permissions", async () => {
    const nobody = await ctx.admin(await ctx.customRole(["billing.read", "users.read"]));
    const response = await ctx.harness.call("GET", "/admin/billing/counts", { jar: nobody.jar });
    expect(response.statusCode).toBe(403);
  });
});
