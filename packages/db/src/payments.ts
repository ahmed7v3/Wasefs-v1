import { randomInt, randomUUID } from "node:crypto";

import { assertSafeAlertSummary } from "@wasfa/shared/alert-safety";
import { PAYMENT_MAX_PROOF_SUBMISSIONS } from "@wasfa/shared/billing";
import { formatMoney } from "@wasfa/shared/money";
import { and, asc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import { moveCreditsInTransaction, type Transaction, type WalletOwner } from "./credits-ledger.js";
import { isUniqueViolation } from "./pg-errors.js";
import { adminAlerts } from "./schema/alerts.js";
import {
  creditPacks,
  orders,
  outbox,
  paymentEvents,
  paymentGateways,
  paymentMethods,
  payments,
  refunds,
  type Order,
  type Payment,
  type PaymentGateway,
  type Refund,
} from "./schema/billing.js";
import { files } from "./schema/files.js";
import { couponRedemptions, coupons, promotions } from "./schema/promotions.js";
import { personalOffers } from "./schema/subscriptions.js";

import type { Database } from "./client.js";
import type { AlertKind, AlertSeverity, OrderKind, PaymentStatus } from "@wasfa/shared/billing";

/*
 * The payment state machine and activation (BILLING §5.2–§5.4, §7.4). Plain functions over a
 * `Database`, like the credits ledger, so the API (checkout, webhooks, refund recording) and the worker
 * (reconciliation, expiry) run the very same transactions.
 *
 * Rules every operation follows:
 *  - Lock order: order -> payment -> coupon -> wallet (BILLING §12). Never the other way round.
 *  - A payment changes state only through `transition`, which checks the current state under the
 *    row lock and writes a `payment_events` row. An illegal move throws `illegal_transition`.
 *  - `activate` is the only place a purchase becomes real, and it is idempotent: a paid order is
 *    returned as is. The amount the provider reported must equal the order total, or nothing
 *    activates and an admin is alerted.
 *  - Side effects outside the database (mail, notifications, rewards) go to the outbox in the same
 *    transaction; the worker drains it.
 */

export type PaymentsErrorReason =
  | "not_found"
  | "illegal_transition"
  | "coupon_unavailable"
  | "not_refundable"
  | "refund_exceeds_paid"
  | "proof_limit"
  | "proof_processing"
  | "proof_invalid"
  | "duplicate_txn"
  | "proof_not_allowed"
  | "same_reviewer";

export class PaymentsError extends Error {
  constructor(readonly reason: PaymentsErrorReason) {
    super(`Payments refused: ${reason}`);
    this.name = "PaymentsError";
  }
}

/** Which state may follow which (BILLING §5.2). Late provider successes are allowed on purpose. */
const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  created: ["awaiting_customer", "succeeded", "failed", "canceled", "expired"],
  awaiting_customer: [
    "processing",
    "awaiting_review",
    "succeeded",
    "failed",
    "canceled",
    "expired",
  ],
  processing: ["succeeded", "failed", "expired"],
  awaiting_review: ["awaiting_second_approval", "awaiting_customer", "succeeded", "rejected"],
  awaiting_second_approval: ["succeeded", "rejected"],
  // The provider took the money after we gave up on the attempt: it must still count.
  failed: ["succeeded"],
  expired: ["succeeded"],
  canceled: ["succeeded"],
  rejected: ["awaiting_review"],
  succeeded: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Payments still waiting for the customer or the provider (reconciliation and expiry look at these). */
export const OPEN_PAYMENT_STATUSES = ["created", "awaiting_customer", "processing"] as const;
const REVIEW_STATUSES = ["awaiting_review", "awaiting_second_approval"] as const;
const PAID_ORDER_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

/**
 * What activation and refunds need from the subscription domain (Task 3.5). Bound to a no-op until
 * that service exists: a subscription order is then marked paid with its outbox event, and 3.5
 * creates the period (its migration backfills paid orders without a subscription).
 */
export interface PaymentHooks {
  activateSubscription(tx: Transaction, input: { order: Order; now: Date }): Promise<void>;
  onRefund(
    tx: Transaction,
    input: { order: Order; payment: Payment; refund: Refund; now: Date },
  ): Promise<void>;
}

export const NO_SUBSCRIPTION_HOOKS: PaymentHooks = {
  activateSubscription: () => Promise.resolve(),
  onRefund: () => Promise.resolve(),
};

// --- Small helpers ------------------------------------------------------------------------------

const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** `WSP-XXXXXX`: short enough to type into a transfer note, without look-alike characters. */
export function paymentReference(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `WSP-${code}`;
}

function orderOwner(order: Order): WalletOwner {
  if (order.ownerUserId) return { type: "user", id: order.ownerUserId };
  if (order.ownerOrgId) return { type: "org", id: order.ownerOrgId };
  throw new Error("Order without owner");
}

async function lockOrder(tx: Transaction, orderId: string): Promise<Order> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw new PaymentsError("not_found");
  return order;
}

async function lockPayment(tx: Transaction, paymentId: string): Promise<Payment> {
  const [payment] = await tx
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .for("update");
  if (!payment) throw new PaymentsError("not_found");
  return payment;
}

/** Locks the order first, then the payment (the fixed lock order). */
async function lockOrderAndPayment(
  tx: Transaction,
  paymentId: string,
): Promise<{ order: Order; payment: Payment }> {
  const [ref] = await tx
    .select({ orderId: payments.orderId })
    .from(payments)
    .where(eq(payments.id, paymentId));
  if (!ref) throw new PaymentsError("not_found");
  const order = await lockOrder(tx, ref.orderId);
  const payment = await lockPayment(tx, paymentId);
  return { order, payment };
}

export async function raiseAdminAlert(
  tx: Transaction | Database,
  alert: {
    kind: AlertKind;
    severity: AlertSeverity;
    refType: string;
    refId: string;
    summary: string;
    link: string;
    /** For jobs that run on a supplied clock; defaults to the database's `now()`. */
    createdAt?: Date;
  },
): Promise<string> {
  const [created] = await tx
    .insert(adminAlerts)
    .values({ ...alert, summary: assertSafeAlertSummary(alert.summary) })
    .returning({ id: adminAlerts.id });
  if (!created) throw new Error("Admin alert was not stored");
  await enqueue(tx, "alerts.fan_out", { alertId: created.id }, `alert:${created.id}`);
  return created.id;
}

async function enqueue(
  tx: Transaction | Database,
  topic: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  await tx
    .insert(outbox)
    .values({ topic, payload, idempotencyKey })
    .onConflictDoNothing({
      target: outbox.idempotencyKey,
      where: sql`${outbox.idempotencyKey} is not null`,
    });
}

/**
 * Moves a locked payment to `to`, or throws `illegal_transition`. Writes the internal event row
 * that makes every state change visible in the payment's timeline.
 */
async function transitionLocked(
  tx: Transaction,
  payment: Payment,
  to: PaymentStatus,
  patch: Partial<Pick<Payment, "failureCode" | "providerRef">> & { reason?: string } = {},
): Promise<Payment> {
  if (!canTransition(payment.status, to)) throw new PaymentsError("illegal_transition");
  const { reason, ...columns } = patch;
  const [updated] = await tx
    .update(payments)
    .set({ ...columns, status: to, updatedAt: sql`now()` })
    .where(eq(payments.id, payment.id))
    .returning();
  if (!updated) throw new PaymentsError("not_found");
  await tx.insert(paymentEvents).values({
    provider: "internal",
    eventId: `transition:${payment.id}:${randomUUID()}`,
    type: "transition",
    paymentId: payment.id,
    payload: { from: payment.status, to, ...(reason ? { reason } : {}) },
    signatureOk: true,
  });
  return updated;
}

/** `PaymentsService.transition` of BILLING §5.2: lock, check, move, record. */
export async function transitionPayment(
  db: Database,
  paymentId: string,
  to: PaymentStatus,
  patch: Partial<Pick<Payment, "failureCode" | "providerRef">> & { reason?: string } = {},
): Promise<Payment> {
  return db.transaction(async (tx) => {
    const { payment } = await lockOrderAndPayment(tx, paymentId);
    return transitionLocked(tx, payment, to, patch);
  });
}

function hammingDistance(left: string, right: string): number {
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (bits !== 0n) {
    count++;
    bits &= bits - 1n;
  }
  return count;
}

/** Validates and attaches one proof while holding the order then payment locks. */
export async function submitManualProof(
  db: Database,
  input: {
    userId: string;
    paymentId: string;
    txnId: string;
    senderPhoneMasked: string;
    senderPhoneEnc: string;
    fileId: string;
  },
): Promise<{ status: PaymentStatus; flags: string[]; alertId: string | null }> {
  try {
    return await db.transaction(async (tx) => {
      const { order, payment } = await lockOrderAndPayment(tx, input.paymentId);
      if (order.ownerUserId !== input.userId) throw new PaymentsError("not_found");
      const [method] = await tx
        .select()
        .from(paymentMethods)
        .where(eq(paymentMethods.key, payment.methodKey));
      if (
        !method ||
        method.kind !== "manual" ||
        !method.requiresProof ||
        payment.gateway !== null
      ) {
        throw new PaymentsError("proof_not_allowed");
      }
      if (order.status !== "pending_payment" || order.expiresAt <= new Date())
        throw new PaymentsError("proof_not_allowed");
      if (payment.status !== "awaiting_customer" && payment.status !== "rejected")
        throw new PaymentsError("proof_not_allowed");
      if (payment.status === "rejected") {
        const rejections = await tx
          .select({ id: paymentEvents.id })
          .from(paymentEvents)
          .where(
            and(
              eq(paymentEvents.paymentId, payment.id),
              eq(paymentEvents.type, "transition"),
              sql`${paymentEvents.payload}->>'to' = 'rejected'`,
            ),
          );
        if (rejections.length !== 1) throw new PaymentsError("proof_not_allowed");
      }
      if (payment.proofSubmissions >= PAYMENT_MAX_PROOF_SUBMISSIONS)
        throw new PaymentsError("proof_limit");
      const [file] = await tx
        .select()
        .from(files)
        .where(and(eq(files.id, input.fileId), eq(files.ownerUserId, input.userId)));
      if (!file || file.purpose !== "payment_proof") throw new PaymentsError("proof_not_allowed");
      if (file.status !== "processed") throw new PaymentsError("proof_processing");
      const [attached] = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(eq(payments.proofFileId, file.id));
      if (attached) throw new PaymentsError("proof_not_allowed");
      const earlier = await tx
        .select({ sha256: files.sha256, dhash: files.dhash, orderNumber: orders.number })
        .from(files)
        .innerJoin(payments, eq(payments.proofFileId, files.id))
        .innerJoin(orders, eq(payments.orderId, orders.id))
        .where(and(eq(files.purpose, "payment_proof"), ne(payments.id, payment.id)));
      const flags: string[] = [];
      for (const prior of earlier) {
        if (file.sha256 && prior.sha256 === file.sha256)
          flags.push(`duplicate_image_sha256:${prior.orderNumber}`);
        else if (file.dhash && prior.dhash && hammingDistance(file.dhash, prior.dhash) <= 6)
          flags.push(`duplicate_image_dhash:${prior.orderNumber}`);
      }
      await tx
        .update(payments)
        .set({
          txnId: input.txnId,
          senderPhoneMasked: input.senderPhoneMasked,
          senderPhoneEnc: input.senderPhoneEnc,
          proofFileId: input.fileId,
          proofSubmissions: payment.proofSubmissions + 1,
          flags: [...new Set([...(payment.flags ?? []), ...flags])],
        })
        .where(eq(payments.id, payment.id));
      const moved = await transitionLocked(
        tx,
        { ...payment, txnId: input.txnId, proofSubmissions: payment.proofSubmissions + 1 },
        "awaiting_review",
      );
      const duplicated = flags.length > 0;
      const alertId = await raiseAdminAlert(tx, {
        kind: "payment.review_needed",
        severity: duplicated ? "critical" : "info",
        refType: "payment",
        refId: payment.id,
        summary: `Order ${order.number}: manual payment ${formatMoney(payment.amountMinor, payment.currency, "en")} needs review. Sender ${input.senderPhoneMasked}.`,
        link: `/admin/billing/payments/${payment.id}`,
      });
      return { status: moved.status, flags, alertId };
    });
  } catch (error) {
    if (isUniqueViolation(error, "payments_method_txn_id_key"))
      throw new PaymentsError("duplicate_txn");
    throw error;
  }
}

// --- Coupons ------------------------------------------------------------------------------------

/** Reserves one use of a coupon for an order, under the coupon's row lock (BILLING §3). */
async function reserveCoupon(
  tx: Transaction,
  couponId: string,
  order: Order,
  now: Date,
): Promise<void> {
  const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, couponId)).for("update");
  const owner = orderOwner(order);
  const usable =
    coupon !== undefined &&
    (coupon.status === "active" || coupon.status === "scheduled") &&
    (coupon.startsAt === null || coupon.startsAt <= now) &&
    (coupon.endsAt === null || coupon.endsAt > now) &&
    (coupon.maxRedemptions === null || coupon.redeemedCount < coupon.maxRedemptions);
  if (!coupon || !usable) throw new PaymentsError("coupon_unavailable");
  if (coupon.perOwnerLimit !== null) {
    const ownerColumn =
      owner.type === "user" ? couponRedemptions.ownerUserId : couponRedemptions.ownerOrgId;
    const [used] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, couponId),
          eq(ownerColumn, owner.id),
          ne(couponRedemptions.status, "released"),
        ),
      );
    if ((used?.total ?? 0) >= coupon.perOwnerLimit) throw new PaymentsError("coupon_unavailable");
  }
  await tx
    .update(coupons)
    .set({ redeemedCount: sql`${coupons.redeemedCount} + 1`, updatedAt: sql`now()` })
    .where(eq(coupons.id, couponId));
  await tx.insert(couponRedemptions).values({
    couponId,
    orderId: order.id,
    ownerUserId: order.ownerUserId,
    ownerOrgId: order.ownerOrgId,
    status: "reserved",
  });
}

/** Gives a reserved use back (order expired or canceled). */
async function releaseCoupon(tx: Transaction, orderId: string, now: Date): Promise<void> {
  const released = await tx
    .update(couponRedemptions)
    .set({ status: "released", releasedAt: now })
    .where(and(eq(couponRedemptions.orderId, orderId), eq(couponRedemptions.status, "reserved")))
    .returning({ couponId: couponRedemptions.couponId });
  for (const { couponId } of released) {
    await tx
      .update(coupons)
      .set({ redeemedCount: sql`greatest(${coupons.redeemedCount} - 1, 0)`, updatedAt: sql`now()` })
      .where(eq(coupons.id, couponId));
  }
}

/**
 * Confirms the order's coupon use. A use released by expiry (a late provider success) is taken
 * again if the coupon still has room; if not, the customer keeps the price they paid and admins
 * are told, because the money is already in.
 */
async function confirmCoupon(tx: Transaction, order: Order, now: Date): Promise<void> {
  const [redemption] = await tx
    .select()
    .from(couponRedemptions)
    .where(eq(couponRedemptions.orderId, order.id));
  if (!redemption || redemption.status === "confirmed") return;
  if (redemption.status === "released") {
    const [coupon] = await tx
      .select()
      .from(coupons)
      .where(eq(coupons.id, redemption.couponId))
      .for("update");
    if (
      coupon &&
      (coupon.maxRedemptions === null || coupon.redeemedCount < coupon.maxRedemptions)
    ) {
      await tx
        .update(coupons)
        .set({ redeemedCount: sql`${coupons.redeemedCount} + 1`, updatedAt: sql`now()` })
        .where(eq(coupons.id, coupon.id));
    } else {
      await raiseAdminAlert(tx, {
        kind: "payment.review_needed",
        severity: "warning",
        refType: "order",
        refId: order.id,
        summary: `Order ${order.number} was paid after expiry; its coupon was used up meanwhile.`,
        link: `/admin/billing/orders/${order.id}`,
      });
      return;
    }
  }
  await tx
    .update(couponRedemptions)
    .set({ status: "confirmed", confirmedAt: now })
    .where(eq(couponRedemptions.id, redemption.id));
}

// --- Orders -------------------------------------------------------------------------------------

export interface NewOrderInput {
  owner: WalletOwner;
  kind: OrderKind;
  planId: string | null;
  packId: string | null;
  months: number | null;
  currency: string;
  quote: Record<string, unknown>;
  quoteHash: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  feeMinor: number;
  totalMinor: number;
  applied: { couponId?: string; promotionId?: string; personalOfferId?: string; dealId?: string };
  expiresAt: Date;
  /** Null for a free order (total 0), which needs no payment. */
  method: { key: string; gateway: string | null } | null;
}

export interface CreatedOrder {
  order: Order;
  payment: Payment | null;
}

/**
 * Creates the order, reserves its coupon and, unless it is free, its first payment
 * (`created`). A free order is activated in the same transaction (BILLING §5.4).
 */
export async function createOrder(
  db: Database,
  input: NewOrderInput,
  hooks: PaymentHooks,
  now = new Date(),
): Promise<CreatedOrder> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            ownerUserId: input.owner.type === "user" ? input.owner.id : null,
            ownerOrgId: input.owner.type === "org" ? input.owner.id : null,
            kind: input.kind,
            planId: input.planId,
            packId: input.packId,
            months: input.months,
            currency: input.currency,
            quote: input.quote,
            quoteHash: input.quoteHash,
            subtotalMinor: input.subtotalMinor,
            discountMinor: input.discountMinor,
            taxMinor: input.taxMinor,
            feeMinor: input.feeMinor,
            totalMinor: input.totalMinor,
            applied: input.applied,
            dealId: input.applied.dealId ?? null,
            expiresAt: input.expiresAt,
          })
          .returning();
        if (!order) throw new Error("Order was not stored");
        if (input.applied.couponId) await reserveCoupon(tx, input.applied.couponId, order, now);

        if (input.totalMinor === 0) {
          const paid = await activateLocked(tx, order, null, now, hooks);
          return { order: paid, payment: null };
        }
        if (!input.method) throw new Error("A paid order needs a payment method");
        const [payment] = await tx
          .insert(payments)
          .values({
            orderId: order.id,
            reference: paymentReference(),
            methodKey: input.method.key,
            gateway: input.method.gateway,
            status: input.method.gateway === null ? "awaiting_customer" : "created",
            amountMinor: input.totalMinor,
            currency: input.currency,
          })
          .returning();
        if (!payment) throw new Error("Payment was not stored");
        return { order, payment };
      });
    } catch (error) {
      // A reference collision (1 in ~900M per pair) is retried with a new one.
      if (attempt < 3 && isUniqueViolation(error, "payments_reference_key")) continue;
      throw error;
    }
  }
}

/** Expires unpaid orders past `expires_at`, releasing their coupons. Orders under review stay. */
export async function expireOrders(
  db: Database,
  now = new Date(),
  limit = 200,
): Promise<{ expired: number }> {
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), lte(orders.expiresAt, now)))
    .orderBy(asc(orders.expiresAt))
    .limit(limit);
  let expired = 0;
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const order = await lockOrder(tx, id);
      if (order.status !== "pending_payment") return false;
      const attempts = await tx
        .select()
        .from(payments)
        .where(eq(payments.orderId, id))
        .orderBy(asc(payments.createdAt))
        .for("update");
      // A customer who already sent money and a proof is waiting for a human, not for a timer.
      if (
        attempts.some((payment) => (REVIEW_STATUSES as readonly string[]).includes(payment.status))
      ) {
        return false;
      }
      for (const payment of attempts) {
        if ((OPEN_PAYMENT_STATUSES as readonly string[]).includes(payment.status)) {
          await transitionLocked(tx, payment, "expired", { reason: "order_expired" });
        }
      }
      await releaseCoupon(tx, id, now);
      await tx
        .update(orders)
        .set({ status: "expired", updatedAt: sql`now()` })
        .where(eq(orders.id, id));
      return true;
    });
    if (done) expired++;
  }
  return { expired };
}

/** The owner cancels an unpaid order. Open attempts are canceled and the coupon is released. */
export async function cancelOrder(db: Database, orderId: string, now = new Date()): Promise<Order> {
  return db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "pending_payment") throw new PaymentsError("illegal_transition");
    const attempts = await tx
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .for("update");
    if (
      attempts.some((payment) => (REVIEW_STATUSES as readonly string[]).includes(payment.status))
    ) {
      throw new PaymentsError("illegal_transition");
    }
    for (const payment of attempts) {
      if ((OPEN_PAYMENT_STATUSES as readonly string[]).includes(payment.status)) {
        await transitionLocked(tx, payment, "canceled", { reason: "order_canceled" });
      }
    }
    await releaseCoupon(tx, orderId, now);
    const [updated] = await tx
      .update(orders)
      .set({ status: "canceled", updatedAt: sql`now()` })
      .where(eq(orders.id, orderId))
      .returning();
    if (!updated) throw new PaymentsError("not_found");
    return updated;
  });
}

// --- Activation ---------------------------------------------------------------------------------

export type ActivationOutcome = "activated" | "already_paid" | "amount_mismatch" | "paid_twice";

/** Grants, redemptions, hooks and outbox for an order that is being marked paid (all under lock). */
async function activateLocked(
  tx: Transaction,
  order: Order,
  payment: Payment | null,
  now: Date,
  hooks: PaymentHooks,
): Promise<Order> {
  const [paid] = await tx
    .update(orders)
    .set({
      status: "paid",
      paidAt: now,
      paymentKind: payment === null ? "free" : payment.gateway ? "gateway" : "manual",
      updatedAt: sql`now()`,
    })
    .where(eq(orders.id, order.id))
    .returning();
  if (!paid) throw new PaymentsError("not_found");

  await confirmCoupon(tx, paid, now);
  const applied = paid.applied as NewOrderInput["applied"];
  if (applied.promotionId) {
    // Counts toward the promotion's limit; a promotion that filled up meanwhile is not over-counted.
    await tx
      .update(promotions)
      .set({ redeemedCount: sql`${promotions.redeemedCount} + 1`, updatedAt: sql`now()` })
      .where(
        and(
          eq(promotions.id, applied.promotionId),
          sql`(${promotions.maxRedemptions} is null or ${promotions.redeemedCount} < ${promotions.maxRedemptions})`,
        ),
      );
  }
  if (applied.personalOfferId) {
    await tx
      .update(personalOffers)
      .set({ consumedAt: now })
      .where(
        and(eq(personalOffers.id, applied.personalOfferId), isNull(personalOffers.consumedAt)),
      );
  }

  const owner = orderOwner(paid);
  if (paid.kind === "credit_pack" && paid.packId) {
    const [pack] = await tx.select().from(creditPacks).where(eq(creditPacks.id, paid.packId));
    if (!pack) throw new Error("Credit pack disappeared");
    await moveCreditsInTransaction(tx, owner, {
      kind: "purchase",
      amount: pack.credits + pack.bonusCredits,
      idempotencyKey: `order:${paid.id}`,
      reason: `credit_pack:${pack.key}`,
    });
  } else {
    await hooks.activateSubscription(tx, { order: paid, now });
  }
  const grants = (paid.quote as { grants?: { bonusCredits?: number } }).grants;
  if (grants?.bonusCredits && grants.bonusCredits > 0) {
    await moveCreditsInTransaction(tx, owner, {
      kind: "purchase",
      amount: grants.bonusCredits,
      idempotencyKey: `order:${paid.id}:bonus`,
      reason: "bonus_credits",
    });
  }
  await enqueue(tx, "billing.order_paid", { orderId: paid.id }, `order_paid:${paid.id}`);
  return paid;
}

/**
 * `onSucceeded` of BILLING §5.3: the provider (or an admin, for manual payments) says the money
 * arrived. `reported` is the amount and currency that party confirmed; it must equal the order.
 */
export async function activatePayment(
  db: Database,
  paymentId: string,
  reported: { amountMinor: number | null; currency: string | null },
  hooks: PaymentHooks,
  now = new Date(),
): Promise<ActivationOutcome> {
  return db.transaction((tx) => activateInTransaction(tx, paymentId, reported, hooks, now));
}

export async function approveManualPayment(
  db: Database,
  paymentId: string,
  adminId: string,
  fourEyesThresholdMinor: number,
  hooks: PaymentHooks,
  note?: string,
  now = new Date(),
): Promise<{ status: PaymentStatus; activated: boolean; activation: ActivationOutcome | null }> {
  return db.transaction(async (tx) => {
    const { order, payment } = await lockOrderAndPayment(tx, paymentId);
    if (payment.gateway !== null || !payment.proofFileId)
      throw new PaymentsError("proof_not_allowed");
    if (payment.status === "awaiting_review") {
      if (payment.amountMinor >= fourEyesThresholdMinor) {
        await tx
          .update(payments)
          .set({ reviewedBy: adminId, reviewedAt: now, reviewNote: note ?? null })
          .where(eq(payments.id, payment.id));
        await transitionLocked(tx, payment, "awaiting_second_approval", {
          reason: "second_approval_required",
        });
        await raiseAdminAlert(tx, {
          kind: "payment.review_needed",
          severity: "warning",
          refType: "payment",
          refId: payment.id,
          summary: `Order ${order.number}: a second approval is required for this manual payment.`,
          link: `/admin/billing/payments/${payment.id}`,
        });
        return { status: "awaiting_second_approval", activated: false, activation: null };
      }
      await tx
        .update(payments)
        .set({ reviewedBy: adminId, reviewedAt: now, reviewNote: note ?? null })
        .where(eq(payments.id, payment.id));
      const activation = await activateInTransaction(
        tx,
        payment.id,
        { amountMinor: order.totalMinor, currency: order.currency },
        hooks,
        now,
      );
      return {
        status: activation === "activated" ? "succeeded" : "failed",
        activated: activation === "activated",
        activation,
      };
    }
    if (payment.status !== "awaiting_second_approval")
      throw new PaymentsError("illegal_transition");
    if (payment.reviewedBy === adminId) throw new PaymentsError("same_reviewer");
    await tx
      .update(payments)
      .set({
        secondApprovedBy: adminId,
        secondApprovedAt: now,
        reviewNote: note ?? payment.reviewNote,
      })
      .where(eq(payments.id, payment.id));
    const activation = await activateInTransaction(
      tx,
      payment.id,
      { amountMinor: order.totalMinor, currency: order.currency },
      hooks,
      now,
    );
    return {
      status: activation === "activated" ? "succeeded" : "failed",
      activated: activation === "activated",
      activation,
    };
  });
}

export async function rejectManualPayment(
  db: Database,
  paymentId: string,
  adminId: string,
  reason: string,
  note?: string,
): Promise<Payment> {
  return db.transaction(async (tx) => {
    const { payment } = await lockOrderAndPayment(tx, paymentId);
    if (payment.gateway !== null || !payment.proofFileId)
      throw new PaymentsError("proof_not_allowed");
    const updated = await tx
      .update(payments)
      .set({
        rejectReason: reason,
        reviewNote: note ?? null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      })
      .where(eq(payments.id, payment.id))
      .returning();
    if (!updated[0]) throw new PaymentsError("not_found");
    const rejected = await transitionLocked(tx, updated[0], "rejected", { reason });
    await enqueue(
      tx,
      "billing.payment_rejected",
      { paymentId },
      `payment_rejected:${paymentId}:${payment.proofSubmissions}`,
    );
    return rejected;
  });
}

export async function requestManualProof(
  db: Database,
  paymentId: string,
  note?: string,
): Promise<Payment> {
  return db.transaction(async (tx) => {
    const { payment } = await lockOrderAndPayment(tx, paymentId);
    if (
      payment.gateway !== null ||
      !payment.proofFileId ||
      payment.status !== "awaiting_review" ||
      payment.proofSubmissions >= PAYMENT_MAX_PROOF_SUBMISSIONS
    )
      throw new PaymentsError("proof_not_allowed");
    const updated = await tx
      .update(payments)
      .set({ reviewNote: note ?? null })
      .where(eq(payments.id, payment.id))
      .returning();
    if (!updated[0]) throw new PaymentsError("not_found");
    const moved = await transitionLocked(tx, updated[0], "awaiting_customer", {
      reason: "proof_resubmission_requested",
    });
    await enqueue(
      tx,
      "billing.payment_resubmit",
      { paymentId },
      `payment_resubmit:${paymentId}:${payment.proofSubmissions}`,
    );
    return moved;
  });
}

async function activateInTransaction(
  tx: Transaction,
  paymentId: string,
  reported: { amountMinor: number | null; currency: string | null },
  hooks: PaymentHooks,
  now: Date,
): Promise<ActivationOutcome> {
  const { order, payment } = await lockOrderAndPayment(tx, paymentId);

  if ((PAID_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    if (
      payment.status === "succeeded" ||
      payment.status === "refunded" ||
      payment.status === "partially_refunded"
    ) {
      return "already_paid";
    }
    // A second attempt also took money for an order that is already paid: record it, refund by hand.
    await transitionLocked(tx, payment, "succeeded", { reason: "order_already_paid" });
    await raiseAdminAlert(tx, {
      kind: "payment.review_needed",
      severity: "critical",
      refType: "payment",
      refId: payment.id,
      summary: `Order ${order.number} was paid twice (payment ${payment.reference}); refund one.`,
      link: `/admin/billing/payments/${payment.id}`,
    });
    return "paid_twice";
  }

  const matches =
    reported.amountMinor === order.totalMinor &&
    reported.currency === order.currency &&
    payment.amountMinor === order.totalMinor &&
    payment.currency === order.currency;
  if (!matches) {
    if (canTransition(payment.status, "failed")) {
      await transitionLocked(tx, payment, "failed", {
        failureCode: "amount_mismatch",
        reason: "amount_mismatch",
      });
    }
    await raiseAdminAlert(tx, {
      kind: "payment.amount_mismatch",
      severity: "critical",
      refType: "payment",
      refId: payment.id,
      summary:
        `Payment ${payment.reference} for order ${order.number}: expected ${order.totalMinor} ${order.currency}, got ${reported.amountMinor ?? "none"} ${reported.currency ?? ""}.`.trim(),
      link: `/admin/billing/payments/${payment.id}`,
    });
    return "amount_mismatch";
  }

  if (payment.status !== "succeeded") await transitionLocked(tx, payment, "succeeded");
  if (order.status === "expired" || order.status === "canceled") {
    await raiseAdminAlert(tx, {
      kind: "payment.review_needed",
      severity: "warning",
      refType: "order",
      refId: order.id,
      summary: `Order ${order.number} was ${order.status} when its payment ${payment.reference} succeeded; it was activated.`,
      link: `/admin/billing/orders/${order.id}`,
    });
  }
  await activateLocked(tx, order, payment, now, hooks);
  return "activated";
}

// --- Provider events ----------------------------------------------------------------------------

export interface ProviderEvent {
  provider: string;
  eventId: string;
  type: string;
  paymentId: string;
  providerRef: string | null;
  state: "pending" | "succeeded" | "failed" | "refunded";
  amountMinor: number | null;
  currency: string | null;
  failureCode: string | null;
  redacted: Record<string, unknown>;
}

export type ProviderEventOutcome =
  "duplicate" | "unknown_payment" | "ignored" | "test" | "failed" | ActivationOutcome;

/**
 * Applies one verified webhook delivery or reconciliation poll. Recording the event and acting on
 * it share one transaction: a duplicate (same provider + event id) changes nothing, and a crash
 * midway leaves neither, so the provider's retry (or the next poll) does the whole thing again.
 */
export async function applyProviderEvent(
  db: Database,
  event: ProviderEvent,
  hooks: PaymentHooks,
  now = new Date(),
): Promise<ProviderEventOutcome> {
  return db.transaction(async (tx) => {
    const [known] = await tx
      .select({ id: payments.id, gateway: payments.gateway })
      .from(payments)
      .where(eq(payments.id, event.paymentId));
    const paymentId = known && known.gateway === event.provider ? known.id : null;

    const [recorded] = await tx
      .insert(paymentEvents)
      .values({
        provider: event.provider,
        eventId: event.eventId,
        type: event.type,
        paymentId,
        payload: event.redacted,
        signatureOk: true,
      })
      .onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.eventId] })
      .returning({ id: paymentEvents.id });
    if (!recorded) return "duplicate";
    if (!paymentId) return "unknown_payment";

    if (event.state === "succeeded") {
      const { payment } = await lockOrderAndPayment(tx, paymentId);
      if (event.providerRef && payment.providerRef === null) {
        await tx
          .update(payments)
          .set({ providerRef: event.providerRef, updatedAt: sql`now()` })
          .where(eq(payments.id, paymentId));
      }
      return activateInTransaction(
        tx,
        paymentId,
        { amountMinor: event.amountMinor, currency: event.currency },
        hooks,
        now,
      );
    }
    if (event.state === "failed") {
      const { payment } = await lockOrderAndPayment(tx, paymentId);
      if (!canTransition(payment.status, "failed")) return "ignored";
      await transitionLocked(tx, payment, "failed", {
        failureCode: event.failureCode ?? "declined",
        ...(event.providerRef && payment.providerRef === null
          ? { providerRef: event.providerRef }
          : {}),
      });
      return "failed";
    }
    if (event.state === "refunded") {
      const { payment } = await lockOrderAndPayment(tx, paymentId);
      if (payment.status !== "refunded" && payment.status !== "partially_refunded") {
        await raiseAdminAlert(tx, {
          kind: "payment.review_needed",
          severity: "warning",
          refType: "payment",
          refId: payment.id,
          summary: `Provider reports a refund for payment ${payment.reference}; record the refund in the admin.`,
          link: `/admin/billing/payments/${payment.id}`,
        });
      }
    }
    return "ignored";
  });
}

/** A delivery whose signature did not verify: kept for the audit trail, never acted on. */
export async function recordRejectedEvent(
  db: Database,
  provider: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(paymentEvents).values({
    provider,
    eventId: `rejected:${randomUUID()}`,
    type: "signature_rejected",
    payload,
    signatureOk: false,
  });
}

/** Attaches the provider's checkout to a new payment: `created -> awaiting_customer`. */
export async function attachCheckout(
  db: Database,
  paymentId: string,
  providerRef: string | null,
): Promise<Payment> {
  return transitionPayment(db, paymentId, "awaiting_customer", providerRef ? { providerRef } : {});
}

/** The enabled `payment_gateways` row of `key` (credentials still sealed). */
export async function enabledGateway(
  db: Database,
  key: string,
): Promise<PaymentGateway | undefined> {
  const [row] = await db
    .select()
    .from(paymentGateways)
    .where(and(eq(paymentGateways.key, key), eq(paymentGateways.enabled, true)));
  return row;
}

/** A configured gateway row, regardless of whether new checkouts are enabled. */
export async function configuredGateway(
  db: Database,
  key: string,
): Promise<PaymentGateway | undefined> {
  const [row] = await db.select().from(paymentGateways).where(eq(paymentGateways.key, key));
  return row;
}

/**
 * Gateway payments the reconciliation job should ask the provider about (BILLING §5.6): open ones
 * quiet for longer than `quietFor`, and ones expired within `lateWindow` (a customer can finish
 * on the provider's page after our timer ran out; that money must still activate).
 */
export async function paymentsToReconcile(
  db: Database,
  now: Date,
  options: { quietForMs: number; lateWindowMs: number; limit?: number },
): Promise<Array<Pick<Payment, "id" | "gateway" | "providerRef">>> {
  const quietSince = new Date(now.getTime() - options.quietForMs);
  const lateSince = new Date(now.getTime() - options.lateWindowMs);
  return db
    .select({ id: payments.id, gateway: payments.gateway, providerRef: payments.providerRef })
    .from(payments)
    .where(
      and(
        sql`${payments.gateway} is not null`,
        or(
          and(
            inArray(payments.status, ["awaiting_customer", "processing"]),
            lte(payments.updatedAt, quietSince),
          ),
          and(eq(payments.status, "expired"), gt(payments.updatedAt, lateSince)),
        ),
      ),
    )
    .orderBy(asc(payments.updatedAt))
    .limit(options.limit ?? 100);
}

// --- Refunds ------------------------------------------------------------------------------------

export interface RefundRequest {
  paymentId: string;
  amountMinor: number;
  reason: string;
  actorId: string;
  /** Plan or pack credits to take back (never below zero); the admin decides (BILLING §7.4). */
  clawbackCredits: number;
}

/** Step 1: validates and records the refund as `approved`, under the order and payment locks. */
export async function openRefund(db: Database, request: RefundRequest): Promise<Refund> {
  return db.transaction(async (tx) => {
    const { payment } = await lockOrderAndPayment(tx, request.paymentId);
    if (payment.status !== "succeeded" && payment.status !== "partially_refunded") {
      throw new PaymentsError("not_refundable");
    }
    const [done] = await tx
      .select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::int` })
      .from(refunds)
      .where(
        and(
          eq(refunds.paymentId, payment.id),
          ne(refunds.status, "rejected"),
          ne(refunds.status, "failed"),
        ),
      );
    if (
      !Number.isSafeInteger(request.amountMinor) ||
      request.amountMinor <= 0 ||
      (done?.total ?? 0) + request.amountMinor > payment.amountMinor
    ) {
      throw new PaymentsError("refund_exceeds_paid");
    }
    const [refund] = await tx
      .insert(refunds)
      .values({
        paymentId: payment.id,
        amountMinor: request.amountMinor,
        currency: payment.currency,
        reason: request.reason,
        status: "approved",
        requestedBy: request.actorId,
        approvedBy: request.actorId,
      })
      .returning();
    if (!refund) throw new Error("Refund was not stored");
    return refund;
  });
}

/**
 * Step 2, after the owner issued the refund externally and supplied its reference:
 * the refund succeeds and its effects apply in one transaction — payment and order states, the
 * subscription hook, the credit clawback.
 */
export async function completeRefund(
  db: Database,
  refundId: string,
  result: {
    providerRef?: string;
    transferReference?: string;
    clawbackCredits: number;
    actorId: string;
  },
  hooks: PaymentHooks,
  now = new Date(),
): Promise<Refund> {
  return db.transaction(async (tx) => {
    const [pending] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
    if (!pending) throw new PaymentsError("not_found");
    const { order, payment } = await lockOrderAndPayment(tx, pending.paymentId);
    const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for("update");
    if (!refund) throw new PaymentsError("not_found");
    if (refund.status === "succeeded") return refund;
    if (refund.status !== "approved") throw new PaymentsError("illegal_transition");

    const [completed] = await tx
      .update(refunds)
      .set({
        status: "succeeded",
        providerRef: result.providerRef ?? null,
        transferReference: result.transferReference ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(refunds.id, refundId))
      .returning();
    if (!completed) throw new PaymentsError("not_found");

    const [sum] = await tx
      .select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, "succeeded")));
    const full = (sum?.total ?? 0) >= payment.amountMinor;
    const to: PaymentStatus = full ? "refunded" : "partially_refunded";
    const moved = await transitionLocked(tx, payment, to, { reason: `refund:${refundId}` });
    await tx
      .update(orders)
      .set({ status: to, updatedAt: sql`now()` })
      .where(eq(orders.id, order.id));

    if (result.clawbackCredits > 0) {
      await moveCreditsInTransaction(tx, orderOwner(order), {
        kind: "admin_adjust",
        amount: -result.clawbackCredits,
        idempotencyKey: `refund:${refundId}:clawback`,
        reason: `refund:${order.number}`,
        actorId: result.actorId,
      });
    }
    await hooks.onRefund(tx, { order, payment: moved, refund: completed, now });
    await enqueue(
      tx,
      "billing.order_refunded",
      { orderId: order.id, refundId },
      `order_refunded:${refundId}`,
    );
    return completed;
  });
}

/** The provider refused the refund: nothing changed on its side, so nothing changes on ours. */
export async function failRefund(db: Database, refundId: string): Promise<void> {
  await db
    .update(refunds)
    .set({ status: "failed", updatedAt: sql`now()` })
    .where(and(eq(refunds.id, refundId), eq(refunds.status, "approved")));
}

// --- Consistency --------------------------------------------------------------------------------

export interface PaymentsConsistency {
  /** Paid credit-pack orders without their purchase ledger row. */
  packsWithoutCredits: string[];
  /** Orders marked paid by a gateway/manual payment without a succeeded (or refunded) payment. */
  paidWithoutPayment: string[];
  /** Succeeded payments whose order is not paid. */
  paymentWithoutPaidOrder: string[];
}

/** Nightly check that paid orders, payments and the credit ledger agree. Ids only. */
export async function checkPaymentsConsistency(
  db: Database,
  limit = 50,
): Promise<PaymentsConsistency> {
  const packs = await db.execute<{ id: string }>(sql`
    select o.id from orders o
    where o.kind = 'credit_pack' and o.status in ('paid', 'partially_refunded', 'refunded')
      and not exists (select 1 from credit_ledger l where l.idempotency_key = 'order:' || o.id::text)
    order by o.id limit ${limit}
  `);
  const paid = await db.execute<{ id: string }>(sql`
    select o.id from orders o
    where o.status in ('paid', 'partially_refunded', 'refunded') and o.payment_kind <> 'free'
      and not exists (
        select 1 from payments p
        where p.order_id = o.id and p.status in ('succeeded', 'partially_refunded', 'refunded')
      )
    order by o.id limit ${limit}
  `);
  const orphan = await db.execute<{ id: string }>(sql`
    select p.id from payments p join orders o on o.id = p.order_id
    where p.status = 'succeeded' and o.status not in ('paid', 'partially_refunded', 'refunded')
    order by p.id limit ${limit}
  `);
  return {
    packsWithoutCredits: packs.map((row) => row.id),
    paidWithoutPayment: paid.map((row) => row.id),
    paymentWithoutPaidOrder: orphan.map((row) => row.id),
  };
}
