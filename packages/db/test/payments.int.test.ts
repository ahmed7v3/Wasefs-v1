import { randomUUID } from "node:crypto";

import { and, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { drainOutbox, outboxBackoffMs, type OutboxHandler } from "../src/outbox.js";
import {
  NO_SUBSCRIPTION_HOOKS,
  PaymentsError,
  activatePayment,
  approveManualPayment,
  applyProviderEvent,
  attachCheckout,
  canTransition,
  cancelOrder,
  checkPaymentsConsistency,
  completeRefund,
  createOrder,
  expireOrders,
  openRefund,
  rejectManualPayment,
  requestManualProof,
  paymentsToReconcile,
  transitionPayment,
  submitManualProof,
  type NewOrderInput,
  type PaymentHooks,
  type ProviderEvent,
} from "../src/payments.js";
import { adminAlerts } from "../src/schema/alerts.js";
import {
  creditPacks,
  orders,
  outbox,
  paymentEvents,
  paymentMethods,
  payments,
} from "../src/schema/billing.js";
import { creditLedger, creditWallets } from "../src/schema/credits.js";
import { files } from "../src/schema/files.js";
import { plans } from "../src/schema/plans.js";
import { couponRedemptions, coupons } from "../src/schema/promotions.js";
import { userNotifications } from "../src/schema/subscriptions.js";
import { users } from "../src/schema/users.js";
import { seedDefaults } from "../src/seed-data.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import { unique, uniqueKey } from "./schema-kit.js";

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

async function manualMethod(key = uniqueKey("instapay")) {
  const [row] = await db()
    .insert(paymentMethods)
    .values({
      key,
      kind: "manual",
      provider: "instapay",
      nameAr: "انستا باي",
      nameEn: "InstaPay",
      instructionsAr: "Pay {amount} to {account}",
      instructionsEn: "Pay {amount} to {account}",
      accountDisplay: "merchant@example",
      currencies: ["EGP"],
      requiresProof: true,
      enabled: true,
    })
    .returning();
  if (!row) throw new Error("manual method insert failed");
  return row;
}

async function openManualOrder(userId: string, methodKey: string) {
  const created = await createOrder(
    db(),
    packOrder(userId, { method: { key: methodKey, gateway: null } }),
    NO_SUBSCRIPTION_HOOKS,
  );
  if (!created.payment) throw new Error("expected a manual payment");
  return { order: created.order, payment: created.payment };
}

async function createProofFile(userId: string, sha256?: string, dhash = "0123456789abcdef") {
  const [file] = await db()
    .insert(files)
    .values({
      ownerUserId: userId,
      createdBy: userId,
      purpose: "payment_proof",
      r2Key: `u/${userId}/${unique("proof")}/processed`,
      mime: "image/jpeg",
      bytes: 1_024,
      sha256: sha256 ?? randomUUID().replaceAll("-", "").padEnd(64, "a"),
      dhash,
      status: "processed",
    })
    .returning();
  if (!file) throw new Error("proof insert failed");
  return file;
}

async function attachProof(userId: string, paymentId: string, txnId = unique("txn")) {
  const file = await createProofFile(userId);
  return submitManualProof(db(), {
    userId,
    paymentId,
    txnId,
    senderPhoneMasked: "010*****678",
    senderPhoneEnc: "sealed",
    fileId: file.id,
  });
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

  it("records an amount-mismatch alert for a large minor-unit amount without aborting the webhook", async () => {
    const { payment } = await openGatewayOrder(await newUser(), {
      subtotalMinor: 10_000_000,
      totalMinor: 10_000_000,
    });
    await expect(
      applyProviderEvent(db(), success(payment.id, 100), NO_SUBSCRIPTION_HOOKS),
    ).resolves.toBe("amount_mismatch");
    const [alert] = await db()
      .select()
      .from(adminAlerts)
      .where(
        and(eq(adminAlerts.refId, payment.id), eq(adminAlerts.kind, "payment.amount_mismatch")),
      );
    expect(alert?.summary).toContain("10000000");
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

describe("manual payment review", () => {
  it("rejects duplicate transaction ids per method and flags exact or near duplicate proof images", async () => {
    const method = await manualMethod();
    const firstBuyer = await newUser();
    const first = await openManualOrder(firstBuyer, method.key);
    const txnId = "TXN-DUPLICATE-123";
    const firstFile = await createProofFile(firstBuyer, "b".repeat(64));
    await submitManualProof(db(), {
      userId: firstBuyer,
      paymentId: first.payment.id,
      txnId,
      senderPhoneMasked: "010*****678",
      senderPhoneEnc: "sealed",
      fileId: firstFile.id,
    });

    const secondBuyer = await newUser();
    const second = await openManualOrder(secondBuyer, method.key);
    const sameImage = await createProofFile(secondBuyer, "b".repeat(64));
    const duplicate = await submitManualProof(db(), {
      userId: secondBuyer,
      paymentId: second.payment.id,
      txnId: "TXN-DUPLICATE-456",
      senderPhoneMasked: "010*****678",
      senderPhoneEnc: "sealed",
      fileId: sameImage.id,
    });
    expect(duplicate.flags).toContain(`duplicate_image_sha256:${first.order.number}`);
    const [alert] = await db()
      .select()
      .from(adminAlerts)
      .where(
        and(
          eq(adminAlerts.refId, second.payment.id),
          eq(adminAlerts.kind, "payment.review_needed"),
        ),
      );
    expect(alert?.severity).toBe("critical");
    const [thirdBuyer, fourthBuyer] = await Promise.all([newUser(), newUser()]);
    const third = await openManualOrder(thirdBuyer, method.key);
    const uniqueTxnProof = await createProofFile(thirdBuyer);
    await submitManualProof(db(), {
      userId: thirdBuyer,
      paymentId: third.payment.id,
      txnId,
      senderPhoneMasked: "010*****678",
      senderPhoneEnc: "sealed",
      fileId: uniqueTxnProof.id,
    }).then(
      () => {
        throw new Error("expected duplicate transaction id");
      },
      (error: unknown) => expect(error).toMatchObject({ reason: "duplicate_txn" }),
    );
    const otherMethod = await manualMethod();
    const fourth = await openManualOrder(fourthBuyer, otherMethod.key);
    const nearDuplicate = await attachProof(fourthBuyer, fourth.payment.id, txnId);
    expect(nearDuplicate.status).toBe("awaiting_review");
    expect(nearDuplicate.flags).toContain(`duplicate_image_dhash:${first.order.number}`);
  });

  it("hides another owner's payment and refuses another user's proof file", async () => {
    const ownerId = await newUser();
    const otherId = await newUser();
    const method = await manualMethod();
    const { payment } = await openManualOrder(ownerId, method.key);
    const foreignFile = await createProofFile(otherId);
    await expect(
      submitManualProof(db(), {
        userId: otherId,
        paymentId: payment.id,
        txnId: "TXN-WRONG-OWNER",
        senderPhoneMasked: "010*****678",
        senderPhoneEnc: "sealed",
        fileId: foreignFile.id,
      }),
    ).rejects.toMatchObject({ reason: "not_found" });
  });

  it("allows one resubmission after rejection and refuses a second rejection or a fourth submission", async () => {
    const buyer = await newUser();
    const method = await manualMethod();
    const { payment } = await openManualOrder(buyer, method.key);
    await attachProof(buyer, payment.id);
    await rejectManualPayment(db(), payment.id, await newUser(), "unreadable_proof");
    await expect(attachProof(buyer, payment.id)).resolves.toMatchObject({
      status: "awaiting_review",
    });
    await rejectManualPayment(db(), payment.id, await newUser(), "not_received");
    await expect(attachProof(buyer, payment.id)).rejects.toMatchObject({
      reason: "proof_not_allowed",
    });

    const secondBuyer = await newUser();
    const second = await openManualOrder(secondBuyer, method.key);
    await attachProof(secondBuyer, second.payment.id);
    await requestManualProof(db(), second.payment.id);
    await attachProof(secondBuyer, second.payment.id);
    await requestManualProof(db(), second.payment.id);
    await attachProof(secondBuyer, second.payment.id);
    await rejectManualPayment(db(), second.payment.id, await newUser(), "wrong_reference");
    await expect(attachProof(secondBuyer, second.payment.id)).rejects.toMatchObject({
      reason: "proof_limit",
    });
  });

  it("allows resubmission after request-proof even when the payment has two prior submissions", async () => {
    const buyer = await newUser();
    const method = await manualMethod();
    const { payment } = await openManualOrder(buyer, method.key);
    await attachProof(buyer, payment.id);
    await requestManualProof(db(), payment.id);
    await attachProof(buyer, payment.id);
    await rejectManualPayment(db(), payment.id, await newUser(), "unreadable_proof");
    await expect(attachProof(buyer, payment.id)).resolves.toMatchObject({
      status: "awaiting_review",
    });
  });

  it("requires a different second reviewer above threshold and activates once", async () => {
    const buyer = await newUser();
    const firstAdmin = await newUser();
    const secondAdmin = await newUser();
    const method = await manualMethod();
    const { order, payment } = await openManualOrder(buyer, method.key);
    expect(payment.status).toBe("awaiting_customer");
    await attachProof(buyer, payment.id);
    expect(
      await approveManualPayment(db(), payment.id, firstAdmin, 7_900, NO_SUBSCRIPTION_HOOKS),
    ).toEqual({ status: "awaiting_second_approval", activated: false, activation: null });
    await expect(
      approveManualPayment(db(), payment.id, firstAdmin, 7_900, NO_SUBSCRIPTION_HOOKS),
    ).rejects.toMatchObject({ reason: "same_reviewer" });
    expect(
      await approveManualPayment(db(), payment.id, secondAdmin, 7_900, NO_SUBSCRIPTION_HOOKS),
    ).toEqual({ status: "succeeded", activated: true, activation: "activated" });
    expect(await orderStatus(order.id)).toBe("paid");
    expect(await purchaseRows(order.id)).toBe(1);
  });

  it("serializes concurrent approvals below threshold to one activation", async () => {
    const buyer = await newUser();
    const method = await manualMethod();
    const { order, payment } = await openManualOrder(buyer, method.key);
    await attachProof(buyer, payment.id);
    const outcomes = await Promise.allSettled([
      approveManualPayment(db(), payment.id, await newUser(), 50_000, NO_SUBSCRIPTION_HOOKS),
      approveManualPayment(db(), payment.id, await newUser(), 50_000, NO_SUBSCRIPTION_HOOKS),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await orderStatus(order.id)).toBe("paid");
    expect(await purchaseRows(order.id)).toBe(1);
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
  // A second ahead keeps these tests independent of the clock; the same-millisecond case itself is
  // covered by "an entry written in the drain's millisecond is due" below.
  const drainAt = () => new Date(Date.now() + 1_000);
  // Entries left by the activation tests above are drained as no-ops here.
  const quiet: Record<string, OutboxHandler> = {
    "billing.order_paid": () => Promise.resolve(),
    "billing.order_refunded": () => Promise.resolve(),
    "rewards.order_paid": () => Promise.resolve(),
    "rewards.order_refunded": () => Promise.resolve(),
    "alerts.fan_out": () => Promise.resolve(),
    "billing.payment_rejected": () => Promise.resolve(),
    "billing.payment_resubmit": () => Promise.resolve(),
  };

  it("an entry written in the drain's millisecond is due (microseconds against milliseconds)", async () => {
    const userId = await newUser();
    await db()
      .insert(outbox)
      .values({ topic: "test.same_ms", payload: {}, idempotencyKey: `ms-${userId}` });
    // 500 microseconds into the millisecond that `now` names; long ago, so nothing else is due.
    await db().execute(
      sql`update outbox set available_at = '2020-01-01T00:00:00.000500Z' where idempotency_key = ${`ms-${userId}`}`,
    );
    let runs = 0;
    await drainOutbox(
      db(),
      {
        ...quiet,
        "test.same_ms": () => {
          runs++;
          return Promise.resolve();
        },
      },
      new Date("2020-01-01T00:00:00.000Z"),
    );
    expect(runs).toBe(1);
  });

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
    const first = await drainOutbox(db(), handlers, drainAt(), 500);
    expect(first.processed).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBe(1);
    expect(first.parked).toBe(1);
    const second = await drainOutbox(db(), handlers, drainAt(), 500);
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
    const result = await drainOutbox(
      db(),
      {
        ...quiet,
        "test.write_then_fail": async (tx) => {
          await tx.insert(userNotifications).values({ userId, kind: "test.note" });
          throw new Error("after write");
        },
      },
      drainAt(),
      500,
    );
    expect(result.failed).toBe(1);
    const notes = await db()
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, userId));
    expect(notes).toHaveLength(0);
  });

  it("runs alert delivery enqueue actions only after the outbox transaction commits", async () => {
    const userId = await newUser();
    const idempotencyKey = `post-commit-${userId}`;
    await db().insert(outbox).values({
      topic: "test.alert",
      payload: {},
      idempotencyKey,
    });
    let committedBeforeEnqueue = false;
    const result = await drainOutbox(
      db(),
      {
        ...quiet,
        "test.alert": async () => {
          await new Promise((resolve) => setTimeout(resolve, 1_100));
          return [
            {
              kind: "alert_delivery" as const,
              deliveryId: userId,
              jobId: `alert-delivery:${userId}`,
            },
          ];
        },
      },
      drainAt(),
      500,
      async (action) => {
        const [entry] = await db()
          .select()
          .from(outbox)
          .where(eq(outbox.idempotencyKey, idempotencyKey));
        committedBeforeEnqueue =
          action.kind === "alert_delivery" &&
          action.deliveryId === userId &&
          entry?.processedAt != null;
      },
    );
    expect(result.processed).toBe(1);
    expect(committedBeforeEnqueue).toBe(true);
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
