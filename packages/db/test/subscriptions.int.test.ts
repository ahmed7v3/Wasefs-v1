import { addDays, addMonthsClamped } from "@wasfa/shared/subscriptions";
import { and, asc, count, desc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  activatePayment,
  attachCheckout,
  completeRefund,
  createOrder,
  NO_SUBSCRIPTION_HOOKS,
  openRefund,
  type NewOrderInput,
} from "../src/payments.js";
import { adminAlerts } from "../src/schema/alerts.js";
import { auditLogs } from "../src/schema/audit-logs.js";
import { outbox, type Order } from "../src/schema/billing.js";
import { creditLedger, creditWallets } from "../src/schema/credits.js";
import { planAssignments, plans } from "../src/schema/plans.js";
import { subscriptionEvents, subscriptions } from "../src/schema/subscriptions.js";
import { users } from "../src/schema/users.js";
import { seedDefaults } from "../src/seed-data.js";
import {
  activateSubscriptionForOrder,
  adminEnd,
  adminExtend,
  adminGrant,
  advanceSubscription,
  backfillPaidSubscriptionOrders,
  cancelAtPeriodEnd,
  resume,
  startTrial,
  SUBSCRIPTION_HOOKS,
  SubscriptionsError,
} from "../src/subscriptions.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import { unique } from "./schema-kit.js";

/*
 * Subscriptions against a real PostgreSQL 18 (BILLING §7): activation through the real payment
 * path, renewals, upgrades, scheduled downgrades, grace and expiry, trials, anniversary grants on
 * a simulated clock, refunds, the backfill and the admin operations. The invariant checked after
 * every step: the subscription's open assignment ends exactly when access should stop.
 */

let testDb: TestDb;
const db = () => testDb.handle.db;
const DAY = 86_400_000;
const GRACE_DAYS = 2;
let plusId: string;
let proId: string;
let clinicId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  await seedDefaults(db());
  const rows = await db().select().from(plans);
  const byKey = (key: string) => {
    const plan = rows.find((row) => row.key === key);
    if (!plan) throw new Error(`plan ${key} not seeded`);
    return plan.id;
  };
  plusId = byKey("plus");
  proId = byKey("pro");
  clinicId = byKey("clinic");
  await db().update(plans).set({ monthlyCredits: 150 }).where(eq(plans.id, plusId));
  await db().update(plans).set({ monthlyCredits: 500 }).where(eq(plans.id, proId));
  await db().update(plans).set({ monthlyCredits: 80 }).where(eq(plans.id, clinicId));
}, 180_000);

afterAll(async () => {
  await testDb?.stop();
});

async function newUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({ name: "Subscriber", email: `${unique("sub")}@example.com`, ...values })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

/** Pays a plan order through the real activation path at `now`. */
async function pay(
  userId: string,
  input: {
    planId: string;
    months: number;
    now: Date;
    kind?: "subscription" | "upgrade";
    quote?: Record<string, unknown>;
    totalMinor?: number;
  },
): Promise<Order> {
  const totalMinor = input.totalMinor ?? 10_000;
  const order: NewOrderInput = {
    owner: { type: "user", id: userId },
    kind: input.kind ?? "subscription",
    planId: input.planId,
    packId: null,
    months: input.months,
    currency: "EGP",
    quote: input.quote ?? { grants: { bonusCredits: 0, extraMonths: 0 } },
    quoteHash: "a".repeat(64),
    subtotalMinor: totalMinor,
    discountMinor: 0,
    taxMinor: 0,
    feeMinor: 0,
    totalMinor,
    applied: {},
    expiresAt: new Date(input.now.getTime() + DAY),
    method: { key: "fake_card", gateway: "fake" },
  };
  const created = await createOrder(db(), order, SUBSCRIPTION_HOOKS);
  if (!created.payment) throw new Error("payment missing");
  await attachCheckout(db(), created.payment.id, `fake_${created.payment.id}`);
  const outcome = await activatePayment(
    db(),
    created.payment.id,
    { amountMinor: totalMinor, currency: "EGP" },
    SUBSCRIPTION_HOOKS,
    input.now,
  );
  expect(outcome).toBe("activated");
  return created.order;
}

async function subscriptionOf(userId: string) {
  const [row] = await db()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerUserId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  if (!row) throw new Error("no subscription");
  return row;
}

async function openAssignment(subscriptionId: string) {
  const [row] = await db()
    .select()
    .from(planAssignments)
    .where(eq(planAssignments.subscriptionId, subscriptionId))
    .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id))
    .limit(1);
  if (!row) throw new Error("no assignment");
  return row;
}

/** The plan the Phase 2 resolver would pick at `at` (newest assignment active then), or null = default. */
async function effectivePlanId(userId: string, at: Date): Promise<string | null> {
  const rows = await db()
    .select()
    .from(planAssignments)
    .where(eq(planAssignments.ownerUserId, userId))
    .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id));
  const active = rows.find(
    (row) =>
      row.startsAt.getTime() <= at.getTime() &&
      (row.endsAt === null || row.endsAt.getTime() > at.getTime()),
  );
  return active?.planId ?? null;
}

async function balanceOf(userId: string): Promise<number> {
  const [wallet] = await db()
    .select({ balance: creditWallets.balance })
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  return wallet?.balance ?? 0;
}

async function ledgerOf(userId: string) {
  const [wallet] = await db()
    .select({ id: creditWallets.id })
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  if (!wallet) return [];
  return db()
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.walletId, wallet.id))
    .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id));
}

async function eventsOf(subscriptionId: string) {
  return db()
    .select()
    .from(subscriptionEvents)
    .where(eq(subscriptionEvents.subscriptionId, subscriptionId))
    .orderBy(asc(subscriptionEvents.createdAt), asc(subscriptionEvents.id));
}

describe("activation and renewal", () => {
  it("a first paid order opens a period, an assignment that ends after grace, and the first grant", async () => {
    const userId = await newUser();
    const now = new Date("2026-03-10T08:00:00.000Z");
    await pay(userId, { planId: plusId, months: 3, now });
    const sub = await subscriptionOf(userId);
    expect(sub).toMatchObject({ status: "active", source: "paid", planId: plusId, monthsPaid: 3 });
    expect(sub.currentPeriodStart.toISOString()).toBe(now.toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-06-10T08:00:00.000Z");
    const assignment = await openAssignment(sub.id);
    expect(assignment.endsAt?.toISOString()).toBe(
      addDays(sub.currentPeriodEnd, GRACE_DAYS).toISOString(),
    );
    expect(await balanceOf(userId)).toBe(150);
    expect((await eventsOf(sub.id)).map((event) => event.type)).toEqual(["created"]);
  });

  it("the same plan again extends from the current end, never overlapping", async () => {
    const userId = await newUser();
    const start = new Date("2026-03-10T08:00:00.000Z");
    await pay(userId, { planId: plusId, months: 1, now: start });
    await pay(userId, { planId: plusId, months: 3, now: new Date("2026-03-25T08:00:00.000Z") });
    const sub = await subscriptionOf(userId);
    expect(sub.currentPeriodStart.toISOString()).toBe(start.toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-07-10T08:00:00.000Z");
    expect(sub.monthsPaid).toBe(4);
    expect((await openAssignment(sub.id)).endsAt?.toISOString()).toBe(
      addDays(sub.currentPeriodEnd, GRACE_DAYS).toISOString(),
    );
  });

  it("renewing in grace restarts the period from now", async () => {
    const userId = await newUser();
    const start = new Date("2026-03-10T08:00:00.000Z");
    await pay(userId, { planId: plusId, months: 1, now: start });
    const sub = await subscriptionOf(userId);
    await advanceSubscription(db(), sub.id, new Date("2026-04-10T09:00:00.000Z"));
    expect((await subscriptionOf(userId)).status).toBe("grace");
    const renewAt = new Date("2026-04-11T08:00:00.000Z");
    await pay(userId, { planId: plusId, months: 1, now: renewAt });
    const renewed = await subscriptionOf(userId);
    expect(renewed).toMatchObject({ status: "active", graceUntil: null });
    expect(renewed.currentPeriodStart.toISOString()).toBe(renewAt.toISOString());
    expect(renewed.currentPeriodEnd.toISOString()).toBe("2026-05-11T08:00:00.000Z");
    expect(await effectivePlanId(userId, new Date("2026-05-12T08:00:00.000Z"))).toBe(plusId);
  });

  it("activation is idempotent per order, through the hook and through duplicate success reports", async () => {
    const userId = await newUser();
    const now = new Date("2026-03-10T08:00:00.000Z");
    const order = await pay(userId, { planId: plusId, months: 1, now });
    await db().transaction((tx) => activateSubscriptionForOrder(tx, order, now));
    await db().transaction((tx) => activateSubscriptionForOrder(tx, order, now));
    const sub = await subscriptionOf(userId);
    expect(sub.monthsPaid).toBe(1);
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-04-10T08:00:00.000Z");
    expect(await eventsOf(sub.id)).toHaveLength(1);
    expect(await balanceOf(userId)).toBe(150);
  });

  it("extra months from a promotion are part of the period", async () => {
    const userId = await newUser();
    const now = new Date("2026-03-10T08:00:00.000Z");
    await pay(userId, {
      planId: plusId,
      months: 3,
      now,
      quote: { grants: { bonusCredits: 0, extraMonths: 1 } },
    });
    expect((await subscriptionOf(userId)).currentPeriodEnd.toISOString()).toBe(
      "2026-07-10T08:00:00.000Z",
    );
  });
});

describe("upgrade and scheduled downgrade", () => {
  it("an upgrade switches now with a full new period, the new plan's credits and the proration recorded", async () => {
    const userId = await newUser();
    await pay(userId, { planId: plusId, months: 1, now: new Date("2026-03-10T08:00:00.000Z") });
    const upgradeAt = new Date("2026-03-20T08:00:00.000Z");
    await pay(userId, {
      planId: proId,
      months: 1,
      now: upgradeAt,
      kind: "upgrade",
      quote: {
        grants: { bonusCredits: 0, extraMonths: 0 },
        lines: [
          { kind: "plan", labelKey: "billing.line.plan", amountMinor: 20_000 },
          { kind: "proration", labelKey: "billing.line.proration", amountMinor: -6_700 },
        ],
      },
    });
    const sub = await subscriptionOf(userId);
    expect(sub).toMatchObject({ planId: proId, status: "active" });
    expect(sub.currentPeriodStart.toISOString()).toBe(upgradeAt.toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-04-20T08:00:00.000Z");
    // The unused plus credits expired; the pro month was granted at once.
    expect(await balanceOf(userId)).toBe(500);
    const upgraded = (await eventsOf(sub.id)).find((event) => event.type === "upgraded");
    expect(upgraded?.data).toMatchObject({
      fromPlanId: plusId,
      toPlanId: proId,
      prorationMinor: 6_700,
    });
    expect(await effectivePlanId(userId, new Date("2026-03-20T09:00:00.000Z"))).toBe(proId);
    expect(await effectivePlanId(userId, new Date("2026-03-15T09:00:00.000Z"))).toBe(plusId);
  });

  it("a lower plan waits for the period end; a second, different downgrade is kept apart and alerted", async () => {
    const userId = await newUser();
    const start = new Date("2026-03-10T08:00:00.000Z");
    await pay(userId, { planId: proId, months: 1, now: start });
    const downgrade = await pay(userId, {
      planId: plusId,
      months: 3,
      now: new Date("2026-03-15T08:00:00.000Z"),
    });
    let sub = await subscriptionOf(userId);
    expect(sub.planId).toBe(proId);
    expect(sub.pendingChange).toMatchObject({
      planId: plusId,
      months: 3,
      orderId: downgrade.id,
      effectiveAt: "2026-04-10T08:00:00.000Z",
    });

    const conflicting = await pay(userId, {
      planId: clinicId,
      months: 1,
      now: new Date("2026-03-16T08:00:00.000Z"),
    });
    sub = await subscriptionOf(userId);
    expect(sub.pendingChange).toMatchObject({ planId: plusId, orderId: downgrade.id });
    const alerts = await db()
      .select()
      .from(adminAlerts)
      .where(and(eq(adminAlerts.refType, "order"), eq(adminAlerts.refId, conflicting.id)));
    expect(alerts).toHaveLength(1);

    const end = sub.currentPeriodEnd;
    await advanceSubscription(db(), sub.id, new Date(end.getTime() + 60_000));
    const applied = await subscriptionOf(userId);
    expect(applied).toMatchObject({ planId: plusId, status: "active", pendingChange: null });
    expect(applied.currentPeriodStart.toISOString()).toBe(end.toISOString());
    expect(applied.currentPeriodEnd.toISOString()).toBe("2026-07-10T08:00:00.000Z");
    expect(await effectivePlanId(userId, new Date(end.getTime() + 120_000))).toBe(plusId);
    expect(await effectivePlanId(userId, new Date(end.getTime() - 120_000))).toBe(proId);
    expect((await openAssignment(applied.id)).endsAt?.toISOString()).toBe(
      addDays(applied.currentPeriodEnd, GRACE_DAYS).toISOString(),
    );
  });
});

describe("period end, grace, expiry and reminders", () => {
  it("reminds at 7/3/1 days, enters grace, reminds daily, expires, and falls back to the default plan", async () => {
    const userId = await newUser();
    const start = new Date("2026-03-10T08:00:00.000Z");
    await pay(userId, { planId: plusId, months: 1, now: start });
    const sub = await subscriptionOf(userId);
    const end = sub.currentPeriodEnd;
    const runAt = async (offsetMs: number) =>
      advanceSubscription(db(), sub.id, new Date(end.getTime() + offsetMs));

    await runAt(-6 * DAY);
    await runAt(-6 * DAY + 3_600_000);
    await runAt(-2 * DAY);
    await runAt(-12 * 3_600_000);
    await runAt(60_000);
    let current = await subscriptionOf(userId);
    expect(current.status).toBe("grace");
    expect(current.graceUntil?.toISOString()).toBe(addDays(end, GRACE_DAYS).toISOString());
    expect((await openAssignment(sub.id)).endsAt?.toISOString()).toBe(
      addDays(end, GRACE_DAYS).toISOString(),
    );
    await runAt(DAY + 60_000);
    await runAt(GRACE_DAYS * DAY + 60_000);
    current = await subscriptionOf(userId);
    expect(current.status).toBe("expired");
    expect(await effectivePlanId(userId, addDays(end, GRACE_DAYS + 1))).toBeNull();
    expect(await effectivePlanId(userId, addDays(end, 1))).toBe(plusId);

    const reminders = await db()
      .select({ key: outbox.idempotencyKey })
      .from(outbox)
      .where(like(outbox.idempotencyKey, `sub_reminder:${sub.id}:%`));
    const slots = reminders.map((row) => row.key?.split(":").at(-1)).sort();
    expect(slots).toEqual(["d1", "d3", "d7", "expired", "g1", "g2"].sort());
    expect(await balanceOf(userId)).toBe(0);
    expect((await eventsOf(sub.id)).map((event) => event.type)).toEqual([
      "created",
      "grace_started",
      "expired",
    ]);
  });

  it("cancel keeps access to the end and never enters grace; resume before the end undoes it", async () => {
    const userId = await newUser();
    const start = new Date("2026-03-10T08:00:00.000Z");
    await pay(userId, { planId: plusId, months: 1, now: start });
    const owner = { type: "user", id: userId } as const;
    let sub = await cancelAtPeriodEnd(db(), owner, new Date("2026-03-12T08:00:00.000Z"));
    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect((await openAssignment(sub.id)).endsAt?.toISOString()).toBe(
      sub.currentPeriodEnd.toISOString(),
    );
    sub = await resume(db(), owner, new Date("2026-03-13T08:00:00.000Z"));
    expect(sub.cancelAtPeriodEnd).toBe(false);
    expect((await openAssignment(sub.id)).endsAt?.toISOString()).toBe(
      addDays(sub.currentPeriodEnd, GRACE_DAYS).toISOString(),
    );

    await cancelAtPeriodEnd(db(), owner, new Date("2026-03-14T08:00:00.000Z"));
    await advanceSubscription(db(), sub.id, new Date(sub.currentPeriodEnd.getTime() + 60_000));
    const ended = await subscriptionOf(userId);
    expect(ended.status).toBe("canceled");
    expect(ended.graceUntil).toBeNull();
    expect(
      await effectivePlanId(userId, new Date(sub.currentPeriodEnd.getTime() + 60_000)),
    ).toBeNull();
    await expect(resume(db(), owner, new Date("2026-04-20T08:00:00.000Z"))).rejects.toBeInstanceOf(
      SubscriptionsError,
    );
  });
});

describe("anniversary grants", () => {
  it("a 12-month prepayment starting on Jan 31 gets exactly 12 grants, whatever the job's schedule", async () => {
    const userId = await newUser();
    const start = new Date("2027-01-31T09:00:00.000Z");
    await pay(userId, { planId: plusId, months: 12, now: start });
    const sub = await subscriptionOf(userId);
    // Four runs a day for 13 months: late, early and repeated runs alike.
    for (let day = 0; day <= 395; day += 1) {
      for (const hour of [0, 9, 9.5, 23]) {
        const at = new Date(start.getTime() + day * DAY + hour * 3_600_000 - 9 * 3_600_000);
        if (at.getTime() < start.getTime()) continue;
        await advanceSubscription(db(), sub.id, at);
      }
      if ((await subscriptionOf(userId)).status === "expired") break;
    }
    const ledger = await ledgerOf(userId);
    const grants = ledger.filter((row) => row.kind === "grant");
    expect(grants).toHaveLength(12);
    expect(grants.map((row) => row.reason)).toContain("subscription:2027-02");
    expect(new Set(grants.map((row) => row.idempotencyKey)).size).toBe(12);
    // Each month's unused credits expired before the next grant and at the end.
    expect(ledger.filter((row) => row.kind === "expiry")).toHaveLength(12);
    expect(await balanceOf(userId)).toBe(0);
    const second = grants[1];
    expect(second?.createdAt.getTime()).toBeGreaterThan(0);
    expect(addMonthsClamped(start, 1).toISOString()).toBe("2027-02-28T09:00:00.000Z");
    // About 1,600 sequential job runs against a real Postgres: well over two minutes on a slower
    // Docker host, so the budget is generous.
  }, 300_000);
});

describe("trials", () => {
  const PHONE = "+201055501234";

  it("needs a verified phone, runs once per account and once per phone, even after the phone moves", async () => {
    await db()
      .update(plans)
      .set({ trialDays: 7, visibility: "public" })
      .where(eq(plans.id, plusId));
    const now = new Date("2026-05-01T08:00:00.000Z");
    const noPhone = await newUser();
    await expect(startTrial(db(), { userId: noPhone, planKey: "plus", now })).rejects.toMatchObject(
      {
        reason: "phone_required",
      },
    );

    const first = await newUser({ phone: PHONE, phoneVerified: true, phoneVerifiedAt: now });
    const trial = await startTrial(db(), { userId: first, planKey: "plus", now });
    expect(trial).toMatchObject({ status: "trialing", source: "trial", planId: plusId });
    expect(trial.currentPeriodEnd.toISOString()).toBe(addDays(now, 7).toISOString());
    expect(await balanceOf(first)).toBe(20);
    expect((await openAssignment(trial.id)).endsAt?.toISOString()).toBe(
      trial.currentPeriodEnd.toISOString(),
    );
    const events = await eventsOf(trial.id);
    expect(JSON.stringify(events)).not.toContain(PHONE);

    await expect(startTrial(db(), { userId: first, planKey: "plus", now })).rejects.toMatchObject({
      reason: "trial_used",
    });

    // The phone moves to another account: the trial stays used for that number.
    await db()
      .update(users)
      .set({ phone: null, phoneVerified: false, phoneVerifiedAt: null })
      .where(eq(users.id, first));
    const second = await newUser({ phone: PHONE, phoneVerified: true, phoneVerifiedAt: now });
    await expect(startTrial(db(), { userId: second, planKey: "plus", now })).rejects.toMatchObject({
      reason: "trial_used",
    });

    // The trial ends back on the default plan, its credits gone.
    await advanceSubscription(db(), trial.id, addDays(now, 8));
    expect((await subscriptionOf(first)).status).toBe("expired");
    expect(await balanceOf(first)).toBe(0);
    expect(await effectivePlanId(first, addDays(now, 8))).toBeNull();
  });

  it("two parallel requests start at most one trial", async () => {
    const now = new Date("2026-05-02T08:00:00.000Z");
    const userId = await newUser({
      phone: "+201055509999",
      phoneVerified: true,
      phoneVerifiedAt: now,
    });
    const results = await Promise.allSettled([
      startTrial(db(), { userId, planKey: "plus", now }),
      startTrial(db(), { userId, planKey: "plus", now }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [row] = await db()
      .select({ total: count() })
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, userId));
    expect(row?.total).toBe(1);
  });

  it("a paid order replaces a running trial and keeps its remaining credits", async () => {
    const now = new Date("2026-05-03T08:00:00.000Z");
    const userId = await newUser({
      phone: "+201055508888",
      phoneVerified: true,
      phoneVerifiedAt: now,
    });
    const trial = await startTrial(db(), { userId, planKey: "plus", now });
    await pay(userId, { planId: proId, months: 1, now: addDays(now, 2) });
    const [ended] = await db().select().from(subscriptions).where(eq(subscriptions.id, trial.id));
    expect(ended?.status).toBe("canceled");
    expect(await balanceOf(userId)).toBe(20 + 500);
    expect((await subscriptionOf(userId)).planId).toBe(proId);
  });
});

describe("refunds", () => {
  async function refundAll(order: Order, amountMinor = 10_000) {
    const [payment] = await db()
      .select()
      .from((await import("../src/schema/billing.js")).payments)
      .where(eq((await import("../src/schema/billing.js")).payments.orderId, order.id));
    if (!payment) throw new Error("payment missing");
    const refund = await openRefund(db(), {
      paymentId: payment.id,
      amountMinor,
      reason: "customer request",
      actorId: await newUser(),
      clawbackCredits: 0,
    });
    return completeRefund(
      db(),
      refund.id,
      { transferReference: "TR-1", clawbackCredits: 0, actorId: refund.requestedBy ?? "" },
      SUBSCRIPTION_HOOKS,
      new Date("2026-03-20T08:00:00.000Z"),
    );
  }

  it("a full refund of an extension takes its months back; of the only period it ends access now", async () => {
    const userId = await newUser();
    await pay(userId, { planId: plusId, months: 1, now: new Date("2026-03-10T08:00:00.000Z") });
    const extension = await pay(userId, {
      planId: plusId,
      months: 3,
      now: new Date("2026-03-12T08:00:00.000Z"),
    });
    await refundAll(extension);
    let sub = await subscriptionOf(userId);
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-04-10T08:00:00.000Z");
    expect(sub.monthsPaid).toBe(1);

    const other = await newUser();
    const only = await pay(other, {
      planId: plusId,
      months: 1,
      now: new Date("2026-03-10T08:00:00.000Z"),
    });
    await refundAll(only);
    sub = await subscriptionOf(other);
    expect(sub.status).toBe("expired");
    expect(await effectivePlanId(other, new Date("2026-03-21T08:00:00.000Z"))).toBeNull();
    expect((await eventsOf(sub.id)).map((event) => event.type)).toContain("refund_applied");
  });

  it("a partial refund changes no access but is recorded", async () => {
    const userId = await newUser();
    const order = await pay(userId, {
      planId: plusId,
      months: 1,
      now: new Date("2026-03-10T08:00:00.000Z"),
    });
    await refundAll(order, 4_000);
    const sub = await subscriptionOf(userId);
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-04-10T08:00:00.000Z");
    const refunded = (await eventsOf(sub.id)).find((event) => event.type === "refund_applied");
    expect(refunded?.data).toMatchObject({ orderId: order.id, full: false });
  });
});

describe("backfill", () => {
  it("activates paid orders that never got a period, at their payment time, once", async () => {
    const userId = await newUser();
    const paidAt = new Date("2026-02-01T08:00:00.000Z");
    const created = await createOrder(
      db(),
      {
        owner: { type: "user", id: userId },
        kind: "subscription",
        planId: plusId,
        packId: null,
        months: 1,
        currency: "EGP",
        quote: { grants: { bonusCredits: 0, extraMonths: 0 } },
        quoteHash: "a".repeat(64),
        subtotalMinor: 10_000,
        discountMinor: 0,
        taxMinor: 0,
        feeMinor: 0,
        totalMinor: 10_000,
        applied: {},
        expiresAt: new Date(paidAt.getTime() + DAY),
        method: { key: "fake_card", gateway: "fake" },
      },
      NO_SUBSCRIPTION_HOOKS,
    );
    if (!created.payment) throw new Error("payment missing");
    await attachCheckout(db(), created.payment.id, `fake_${created.payment.id}`);
    await activatePayment(
      db(),
      created.payment.id,
      { amountMinor: 10_000, currency: "EGP" },
      NO_SUBSCRIPTION_HOOKS,
      paidAt,
    );
    expect(
      await db().select().from(subscriptions).where(eq(subscriptions.ownerUserId, userId)),
    ).toHaveLength(0);

    expect(await backfillPaidSubscriptionOrders(db())).toBeGreaterThanOrEqual(1);
    const sub = await subscriptionOf(userId);
    expect(sub.currentPeriodStart.toISOString()).toBe(paidAt.toISOString());
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-03-01T08:00:00.000Z");
    expect(await backfillPaidSubscriptionOrders(db())).toBe(0);
    expect(await eventsOf(sub.id)).toHaveLength(1);
  });
});

describe("admin operations", () => {
  it("grants, extends and ends with an event and an audit row each; refuses over a paid period", async () => {
    const userId = await newUser();
    const actorId = await newUser();
    const owner = { type: "user", id: userId } as const;
    const now = new Date("2026-06-01T08:00:00.000Z");
    const granted = await adminGrant(db(), {
      owner,
      planId: proId,
      length: { days: 30 },
      reason: "Partner clinic pilot",
      actorId,
      now,
    });
    expect(granted).toMatchObject({ source: "admin_grant", status: "active", planId: proId });
    expect(await balanceOf(userId)).toBe(500);
    // A grant has no grace: access ends with the period.
    expect((await openAssignment(granted.id)).endsAt?.toISOString()).toBe(
      granted.currentPeriodEnd.toISOString(),
    );

    const extended = await adminExtend(db(), {
      subscriptionId: granted.id,
      length: { days: 10 },
      reason: "Goodwill",
      actorId,
      now,
    });
    expect(extended.currentPeriodEnd.toISOString()).toBe(addDays(now, 40).toISOString());

    const ended = await adminEnd(db(), {
      subscriptionId: granted.id,
      reason: "Pilot over",
      actorId,
      now: addDays(now, 5),
    });
    expect(ended.status).toBe("expired");
    expect(await effectivePlanId(userId, addDays(now, 6))).toBeNull();
    const audits = await db().select().from(auditLogs).where(eq(auditLogs.targetId, granted.id));
    expect(audits.map((row) => row.action).sort()).toEqual([
      "subscription.ended",
      "subscription.extended",
      "subscription.granted",
    ]);

    const payer = await newUser();
    await pay(payer, { planId: plusId, months: 1, now });
    await expect(
      adminGrant(db(), {
        owner: { type: "user", id: payer },
        planId: proId,
        length: { months: 1 },
        reason: "x",
        actorId,
        now,
      }),
    ).rejects.toMatchObject({ reason: "paid_subscription_live" });
  });
});
