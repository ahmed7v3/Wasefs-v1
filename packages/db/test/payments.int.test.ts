import { randomUUID } from "node:crypto";

import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drainOutbox, outboxBackoffMs, type OutboxHandler } from "../src/outbox.js";
import {
  NO_SUBSCRIPTION_HOOKS,
  PaymentsError,
  activatePayment,
  applyProviderEvent,
  attachCheckout,
  canTransition,
  cancelOrder,
  checkPaymentsConsistency,
  completeRefund,
  createOrder,
  expireOrders,
  openRefund,
  paymentsToReconcile,
  transitionPayment,
  type NewOrderInput,
  type PaymentHooks,
  type ProviderEvent,
} from "../src/payments.js";
import { adminAlerts } from "../src/schema/alerts.js";
import { creditPacks, orders, outbox, paymentEvents, payments } from "../src/schema/billing.js";
import { creditLedger, creditWallets } from "../src/schema/credits.js";
import { plans } from "../src/schema/plans.js";
import { couponRedemptions, coupons } from "../src/schema/promotions.js";
import { userNotifications } from "../src/schema/subscriptions.js";
import { users } from "../src/schema/users.js";
import { seedDefaults } from "../src/seed-data.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import { unique } from "./schema-kit.js";

/*
 * The payment state machine and activation (BILLING §5) against a real PostgreSQL 18:
 * idempotency under duplicate deliveries, amount checks, expiry, coupons, refunds and the outbox.
 */

let testDb: TestDb;
const db = () => testDb.handle.db;
const HASH = "a".repeat(64);
const HOUR = 3_600_000;

let packId: string;
let packCredits: number;

beforeAll(async () => {
  testDb = await startTestDb();
  await seedDefaults(db());
  const [pack] = await db().select().from(creditPacks).limit(1);
  if (!pack) throw new Error("no credit pack seeded");
  packId = pack.id;
  packCredits = pack.credits + pack.bonusCredits;
}, 180_000);

afterAll(async () => {
  await testDb?.stop();
});

async function newUser(): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({ name: "Buyer", email: `${unique("buyer")}@example.com` })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

function packOrder(userId: string, extra: Partial<NewOrderInput> = {}): NewOrderInput {
  return {
    owner: { type: "user", id: userId },
    kind: "credit_pack",
    planId: null,
    packId,
    months: null,
    currency: "EGP",
    quote: { grants: { bonusCredits: 0, extraMonths: 0 } },
    quoteHash: HASH,
    subtotalMinor: 7_900,
    discountMinor: 0,
    taxMinor: 0,
    feeMinor: 0,
    totalMinor: 7_900,
    applied: {},
    expiresAt: new Date(Date.now() + 24 * HOUR),
    method: { key: "fake_card", gateway: "fake" },
    ...extra,
  };
}

async function openGatewayOrder(userId: string, extra: Partial<NewOrderInput> = {}) {
  const created = await createOrder(db(), packOrder(userId, extra), NO_SUBSCRIPTION_HOOKS);
  if (!created.payment) throw new Error("expected a payment");
  const payment = await attachCheckout(db(), created.payment.id, `fake_${created.payment.id}`);
  return { order: created.order, payment };
}

function success(
  paymentId: string,
  amountMinor = 7_900,
  eventId: string = randomUUID(),
): ProviderEvent {
  return {
    provider: "fake",
    eventId,
    type: "payment",
    paymentId,
    providerRef: `fake_${paymentId}`,
    state: "succeeded",
    amountMinor,
    currency: "EGP",
    failureCode: null,
    redacted: {},
  };
}

async function orderStatus(orderId: string) {
  const [row] = await db().select().from(orders).where(eq(orders.id, orderId));
  return row?.status;
}

async function purchaseRows(orderId: string): Promise<number> {
  const [row] = await db()
    .select({ total: count() })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, `order:${orderId}`));
  return row?.total ?? 0;
}

async function balanceOf(userId: string): Promise<number> {
  const [wallet] = await db()
    .select()
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  return wallet?.balance ?? 0;
}

describe("state machine", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("created", "awaiting_customer")).toBe(true);
    expect(canTransition("awaiting_customer", "succeeded")).toBe(true);
    expect(canTransition("succeeded", "failed")).toBe(false);
    expect(canTransition("refunded", "succeeded")).toBe(false);
    // A provider success after we gave up still counts.
    expect(canTransition("expired", "succeeded")).toBe(true);
  });

  it("refuses an illegal transition with CONFLICT-style error and records legal ones", async () => {
    const { payment } = await openGatewayOrder(await newUser());
    await expect(transitionPayment(db(), payment.id, "refunded")).rejects.toMatchObject({
      reason: "illegal_transition",
    });
    await transitionPayment(db(), payment.id, "processing");
    const events = await db()
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.paymentId, payment.id), eq(paymentEvents.provider, "internal")));
    expect(events.map((event) => event.payload.to)).toEqual(["awaiting_customer", "processing"]);
  });
});

describe("activation", () => {
  it("10 duplicate deliveries in parallel activate exactly once", async () => {
    const userId = await newUser();
    const { order, payment } = await openGatewayOrder(userId);
    const event = success(payment.id, 7_900, "evt-dup");
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => applyProviderEvent(db(), event, NO_SUBSCRIPTION_HOOKS)),
    );
    expect(outcomes.filter((outcome) => outcome === "activated")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "duplicate")).toHaveLength(9);
    expect(await orderStatus(order.id)).toBe("paid");
    expect(await purchaseRows(order.id)).toBe(1);
    expect(await balanceOf(userId)).toBe(packCredits);
    const queued = await db()
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `order_paid:${order.id}`));
    expect(queued).toHaveLength(1);
  });

  it("different events for the same success activate once (webhook and poll)", async () => {
    const { order, payment } = await openGatewayOrder(await newUser());
    expect(await applyProviderEvent(db(), success(payment.id), NO_SUBSCRIPTION_HOOKS)).toBe(
      "activated",
    );
    expect(await applyProviderEvent(db(), success(payment.id), NO_SUBSCRIPTION_HOOKS)).toBe(
      "already_paid",
    );
    expect(await purchaseRows(order.id)).toBe(1);
  });

  it("an amount mismatch never activates and alerts an admin", async () => {
    const userId = await newUser();
    const { order, payment } = await openGatewayOrder(userId);
    expect(await applyProviderEvent(db(), success(payment.id, 100), NO_SUBSCRIPTION_HOOKS)).toBe(
      "amount_mismatch",
    );
    expect(await orderStatus(order.id)).toBe("pending_payment");
    expect(await purchaseRows(order.id)).toBe(0);
    const [stored] = await db().select().from(payments).where(eq(payments.id, payment.id));
    expect(stored?.status).toBe("failed");
    expect(stored?.failureCode).toBe("amount_mismatch");
    const alerts = await db()
      .select()
      .from(adminAlerts)
      .where(
        and(eq(adminAlerts.refId, payment.id), eq(adminAlerts.kind, "payment.amount_mismatch")),
      );
    expect(alerts).toHaveLength(1);
  });

  it("a currency mismatch or a missing amount is a mismatch too", async () => {
    const { payment } = await openGatewayOrder(await newUser());
    expect(
      await activatePayment(
        db(),
        payment.id,
        { amountMinor: 7_900, currency: "SAR" },
        NO_SUBSCRIPTION_HOOKS,
      ),
    ).toBe("amount_mismatch");
    const second = await openGatewayOrder(await newUser());
    expect(
      await activatePayment(
        db(),
        second.payment.id,
        { amountMinor: null, currency: "EGP" },
        NO_SUBSCRIPTION_HOOKS,
      ),
    ).toBe("amount_mismatch");
  });

  it("an event for an unknown or foreign-gateway payment is recorded and ignored", async () => {
    const outcome = await applyProviderEvent(db(), success(randomUUID()), NO_SUBSCRIPTION_HOOKS);
    expect(outcome).toBe("unknown_payment");
    const { payment } = await openGatewayOrder(await newUser());
    const foreign = { ...success(payment.id), provider: "kashier" };
    expect(await applyProviderEvent(db(), foreign, NO_SUBSCRIPTION_HOOKS)).toBe("unknown_payment");
  });

  it("a hook failure rolls back the whole activation, including the event row", async () => {
    const [plan] = await db().select().from(plans).limit(1);
    if (!plan) throw new Error("no plan");
    const userId = await newUser();
    const created = await createOrder(
      db(),
      packOrder(userId, { kind: "subscription", packId: null, planId: plan.id, months: 1 }),
      NO_SUBSCRIPTION_HOOKS,
    );
    if (!created.payment) throw new Error("expected a payment");
    const crashing: PaymentHooks = {
      ...NO_SUBSCRIPTION_HOOKS,
      activateSubscription: () => Promise.reject(new Error("crash")),
    };
    const event = success(created.payment.id, 7_900, "evt-hook-crash");
    await expect(applyProviderEvent(db(), event, crashing)).rejects.toThrow("crash");
    expect(await orderStatus(created.order.id)).toBe("pending_payment");
    const recorded = await db()
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.eventId, "evt-hook-crash"));
    expect(recorded).toHaveLength(0);
    // The provider retries the same delivery: now it works, once.
    expect(await applyProviderEvent(db(), event, NO_SUBSCRIPTION_HOOKS)).toBe("activated");
    expect(await orderStatus(created.order.id)).toBe("paid");
  });

  it("a second paid attempt on a paid order is recorded and alerted, not activated again", async () => {
    const userId = await newUser();
    const { order, payment } = await openGatewayOrder(userId);
    await applyProviderEvent(db(), success(payment.id), NO_SUBSCRIPTION_HOOKS);
    const [second] = await db()
      .insert(payments)
      .values({
        orderId: order.id,
        reference: `WSP-${randomUUID().slice(0, 6).toUpperCase()}`,
        methodKey: "fake_card",
        gateway: "fake",
        amountMinor: 7_900,
        currency: "EGP",
        status: "awaiting_customer",
      })
      .returning();
    if (!second) throw new Error("insert failed");
    expect(await applyProviderEvent(db(), success(second.id), NO_SUBSCRIPTION_HOOKS)).toBe(
      "paid_twice",
    );
    expect(await purchaseRows(order.id)).toBe(1);
    expect(await balanceOf(userId)).toBe(packCredits);
  });

  it("a failed delivery marks the attempt failed and keeps the order open", async () => {
    const { order, payment } = await openGatewayOrder(await newUser());
    const outcome = await applyProviderEvent(
      db(),
      { ...success(payment.id), state: "failed", failureCode: "declined" },
      NO_SUBSCRIPTION_HOOKS,
    );
    expect(outcome).toBe("failed");
    expect(await orderStatus(order.id)).toBe("pending_payment");
  });
});

describe("free orders, coupons and expiry", () => {
  async function newCoupon(max: number | null, perOwner: number | null = null) {
    const [row] = await db()
      .insert(coupons)
      .values({
        code: unique("C")
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, ""),
        kind: "percent",
        name: "Test",
        titleAr: "كوبون",
        titleEn: "Coupon",
        value: 1_000,
        status: "active",
        maxRedemptions: max,
        perOwnerLimit: perOwner,
      })
      .returning();
    if (!row) throw new Error("coupon insert failed");
    return row;
  }

  it("a free order activates without a payment and counts its coupon", async () => {
    const userId = await newUser();
    const coupon = await newCoupon(5);
    const created = await createOrder(
      db(),
      packOrder(userId, {
        subtotalMinor: 0,
        totalMinor: 0,
        discountMinor: 7_900,
        applied: { couponId: coupon.id },
        method: null,
      }),
      NO_SUBSCRIPTION_HOOKS,
    );
    expect(created.payment).toBeNull();
    expect(created.order.status).toBe("paid");
    expect(created.order.paymentKind).toBe("free");
    const [redemption] = await db()
      .select()
      .from(couponRedemptions)
      .where(eq(couponRedemptions.orderId, created.order.id));
    expect(redemption?.status).toBe("confirmed");
    expect(await balanceOf(userId)).toBe(packCredits);
  });

  it("100 parallel orders on a 10-use coupon reserve exactly 10", async () => {
    const coupon = await newCoupon(10);
    const buyers = await Promise.all(Array.from({ length: 100 }, () => newUser()));
    const results = await Promise.allSettled(
      buyers.map((userId) =>
        createOrder(
          db(),
          packOrder(userId, { applied: { couponId: coupon.id } }),
          NO_SUBSCRIPTION_HOOKS,
        ),
      ),
    );
    const ok = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof PaymentsError &&
        result.reason.reason === "coupon_unavailable",
    );
    expect(ok).toHaveLength(10);
    expect(refused).toHaveLength(90);
    const [row] = await db().select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(row?.redeemedCount).toBe(10);
  }, 60_000);

  it("the per-owner limit counts live redemptions", async () => {
    const userId = await newUser();
    const coupon = await newCoupon(null, 1);
    await createOrder(
      db(),
      packOrder(userId, { applied: { couponId: coupon.id } }),
      NO_SUBSCRIPTION_HOOKS,
    );
    await expect(
      createOrder(
        db(),
        packOrder(userId, { applied: { couponId: coupon.id } }),
        NO_SUBSCRIPTION_HOOKS,
      ),
    ).rejects.toMatchObject({ reason: "coupon_unavailable" });
  });

  it("expiry closes the order, expires open attempts and releases the coupon", async () => {
    const userId = await newUser();
    const coupon = await newCoupon(1);
    const { order, payment } = await openGatewayOrder(userId, {
      applied: { couponId: coupon.id },
      expiresAt: new Date(Date.now() - 1_000),
    });
    const result = await expireOrders(db());
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await orderStatus(order.id)).toBe("expired");
    const [attempt] = await db().select().from(payments).where(eq(payments.id, payment.id));
    expect(attempt?.status).toBe("expired");
    const [row] = await db().select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(row?.redeemedCount).toBe(0);

    // The provider reports success after all: the money counts, the coupon is taken again.
    expect(await applyProviderEvent(db(), success(payment.id), NO_SUBSCRIPTION_HOOKS)).toBe(
      "activated",
    );
    expect(await orderStatus(order.id)).toBe("paid");
    const [after] = await db().select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(after?.redeemedCount).toBe(1);
  });

  it("an order whose proof is under review does not expire", async () => {
    const { order, payment } = await openGatewayOrder(await newUser(), {
      expiresAt: new Date(Date.now() - 1_000),
    });
    await transitionPayment(db(), payment.id, "awaiting_review");
    await expireOrders(db());
    expect(await orderStatus(order.id)).toBe("pending_payment");
  });

  it("the owner can cancel an unpaid order; the coupon goes back", async () => {
    const coupon = await newCoupon(1);
    const { order } = await openGatewayOrder(await newUser(), { applied: { couponId: coupon.id } });
    const canceled = await cancelOrder(db(), order.id);
    expect(canceled.status).toBe("canceled");
    const [row] = await db().select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(row?.redeemedCount).toBe(0);
  });
});

describe("reconciliation candidates", () => {
  it("lists open gateway payments quiet for long enough and recently expired ones", async () => {
    const { payment } = await openGatewayOrder(await newUser());
    const later = new Date(Date.now() + 11 * 60_000);
    const listed = await paymentsToReconcile(db(), later, {
      quietForMs: 10 * 60_000,
      lateWindowMs: HOUR,
      limit: 1_000,
    });
    expect(listed.map((row) => row.id)).toContain(payment.id);
    const now = await paymentsToReconcile(db(), new Date(), {
      quietForMs: 10 * 60_000,
      lateWindowMs: HOUR,
      limit: 1_000,
    });
    expect(now.map((row) => row.id)).not.toContain(payment.id);
  });
});

describe("refunds", () => {
  it("a full refund refunds payment and order and claws credits back once", async () => {
    const userId = await newUser();
    const { order, payment } = await openGatewayOrder(userId);
    await applyProviderEvent(db(), success(payment.id), NO_SUBSCRIPTION_HOOKS);
    const refund = await openRefund(db(), {
      paymentId: payment.id,
      amountMinor: 7_900,
      reason: "customer asked",
      actorId: userId,
      clawbackCredits: packCredits,
    });
    await expect(
      openRefund(db(), {
        paymentId: payment.id,
        amountMinor: 1,
        reason: "too much",
        actorId: userId,
        clawbackCredits: 0,
      }),
    ).rejects.toMatchObject({ reason: "refund_exceeds_paid" });
    const done = await completeRefund(
      db(),
      refund.id,
      { providerRef: "fake_refund_1", clawbackCredits: packCredits, actorId: userId },
      NO_SUBSCRIPTION_HOOKS,
    );
    expect(done.status).toBe("succeeded");
    // Completing twice changes nothing.
    await completeRefund(
      db(),
      refund.id,
      { providerRef: "fake_refund_1", clawbackCredits: packCredits, actorId: userId },
      NO_SUBSCRIPTION_HOOKS,
    );
    expect(await orderStatus(order.id)).toBe("refunded");
    expect(await balanceOf(userId)).toBe(0);
  });

  it("a partial refund leaves the rest refundable and never takes credits below zero", async () => {
    const userId = await newUser();
    const { order, payment } = await openGatewayOrder(userId);
    await applyProviderEvent(db(), success(payment.id), NO_SUBSCRIPTION_HOOKS);
    const refund = await openRefund(db(), {
      paymentId: payment.id,
      amountMinor: 2_000,
      reason: "partial",
      actorId: userId,
      clawbackCredits: packCredits * 10,
    });
    await completeRefund(
      db(),
      refund.id,
      { transferReference: "TRX-1", clawbackCredits: packCredits * 10, actorId: userId },
      NO_SUBSCRIPTION_HOOKS,
    );
    expect(await orderStatus(order.id)).toBe("partially_refunded");
    expect(await balanceOf(userId)).toBe(0);
  });

  it("an unpaid payment is not refundable", async () => {
    const { payment } = await openGatewayOrder(await newUser());
    await expect(
      openRefund(db(), {
        paymentId: payment.id,
        amountMinor: 100,
        reason: "nope",
        actorId: randomUUID(),
        clawbackCredits: 0,
      }),
    ).rejects.toMatchObject({ reason: "not_refundable" });
  });
});

describe("outbox", () => {
  // Entries left by the activation tests above are drained as no-ops here.
  const quiet: Record<string, OutboxHandler> = {
    "billing.order_paid": () => Promise.resolve(),
    "billing.order_refunded": () => Promise.resolve(),
  };

  it("runs each entry once, retries failures with backoff and parks unknown topics", async () => {
    const userId = await newUser();
    await db()
      .insert(outbox)
      .values([
        { topic: "test.ok", payload: { userId }, idempotencyKey: `ok-${userId}` },
        { topic: "test.fail", payload: {}, idempotencyKey: `fail-${userId}` },
        { topic: "test.unknown", payload: {}, idempotencyKey: `unknown-${userId}` },
      ]);
    let runs = 0;
    const handlers: Record<string, OutboxHandler> = {
      ...quiet,
      "test.ok": () => {
        runs++;
        return Promise.resolve();
      },
      "test.fail": () => Promise.reject(new TypeError("boom")),
    };
    const first = await drainOutbox(db(), handlers);
    expect(first.processed).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBe(1);
    expect(first.parked).toBe(1);
    const second = await drainOutbox(db(), handlers);
    expect(second).toEqual({ processed: 0, failed: 0, parked: 0 });
    expect(runs).toBe(1);
    const [failed] = await db()
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `fail-${userId}`));
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBe("TypeError");
    expect(outboxBackoffMs(1)).toBe(60_000);
    expect(outboxBackoffMs(20)).toBe(86_400_000);
  });

  it("a handler's database writes commit only with the processed mark", async () => {
    const userId = await newUser();
    await db()
      .insert(outbox)
      .values({
        topic: "test.write_then_fail",
        payload: { userId },
        idempotencyKey: `wf-${userId}`,
      });
    const result = await drainOutbox(db(), {
      ...quiet,
      "test.write_then_fail": async (tx) => {
        await tx.insert(userNotifications).values({ userId, kind: "test.note" });
        throw new Error("after write");
      },
    });
    expect(result.failed).toBe(1);
    const notes = await db()
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, userId));
    expect(notes).toHaveLength(0);
  });
});

describe("consistency", () => {
  it("reports nothing for a healthy database", async () => {
    const report = await checkPaymentsConsistency(db());
    // The double-paid test leaves a second succeeded payment on a paid order: not drift.
    expect(report).toEqual({
      packsWithoutCredits: [],
      paidWithoutPayment: [],
      paymentWithoutPaidOrder: [],
    });
  });
});
