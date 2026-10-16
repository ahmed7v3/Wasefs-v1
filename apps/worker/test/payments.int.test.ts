import {
  NO_SUBSCRIPTION_HOOKS,
  attachCheckout,
  createDb,
  createOrder,
  creditPacks,
  drainOutbox,
  orders,
  outbox,
  payments,
  seedDefaults,
  userNotifications,
  users,
} from "@wasfa/db";
import { createFakeGateway } from "@wasfa/shared/gateways";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { outboxHandlers } from "../src/jobs/outbox.job.js";
import { RECONCILE_QUIET_MS, reconcilePayments } from "../src/jobs/payments.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

import type { EmailSendInput } from "@wasfa/shared/email";

/*
 * Reconciliation and the receipt outbox (Task 3.3), run as the restricted `wasfa_api` role the
 * worker uses in production: payment_events is insert-only for it, and the order sequence must
 * be usable.
 */

let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let api: ReturnType<typeof createDb>;
let packId: string;
let counter = 0;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  api = createDb({ url: postgres.apiUrl, max: 4 });
  await seedDefaults(owner.db);
  const [pack] = await owner.db.select().from(creditPacks).limit(1);
  if (!pack) throw new Error("no pack seeded");
  packId = pack.id;
}, 180_000);

afterAll(async () => {
  await api?.close();
  await owner?.close();
  await postgres?.stop();
});

async function openOrder() {
  const [user] = await owner.db
    .insert(users)
    .values({ name: "Buyer", email: `buyer-${String(++counter)}@example.com`, locale: "en" })
    .returning();
  if (!user) throw new Error("user insert failed");
  const created = await createOrder(
    api.db,
    {
      owner: { type: "user", id: user.id },
      kind: "credit_pack",
      planId: null,
      packId,
      months: null,
      currency: "EGP",
      quote: { grants: { bonusCredits: 0, extraMonths: 0 } },
      quoteHash: "b".repeat(64),
      subtotalMinor: 7_900,
      discountMinor: 0,
      taxMinor: 0,
      feeMinor: 0,
      totalMinor: 7_900,
      applied: {},
      expiresAt: new Date(Date.now() + 3_600_000),
      method: { key: "fake_card", gateway: "fake" },
    },
    NO_SUBSCRIPTION_HOOKS,
  );
  if (!created.payment) throw new Error("expected a payment");
  const payment = await attachCheckout(api.db, created.payment.id, `fake_${created.payment.id}`);
  return { user, order: created.order, payment };
}

describe("payments.reconcile", () => {
  it("picks up a payment whose webhook was lost, once", async () => {
    const { order, payment } = await openOrder();
    const fake = createFakeGateway("secret");
    fake.statuses.set(payment.id, {
      paymentId: payment.id,
      providerRef: `fake_${payment.id}`,
      state: "succeeded",
      amountMinor: 7_900,
      currency: "EGP",
      failureCode: null,
    });
    const gateways = (key: string) => Promise.resolve(key === "fake" ? fake : null);

    // Too fresh: the webhook may still come.
    const early = await reconcilePayments(api.db, gateways, NO_SUBSCRIPTION_HOOKS, new Date());
    expect(early.applied).toBe(0);

    const later = new Date(Date.now() + RECONCILE_QUIET_MS + 60_000);
    const first = await reconcilePayments(api.db, gateways, NO_SUBSCRIPTION_HOOKS, later);
    expect(first.applied).toBe(1);
    const [paid] = await owner.db.select().from(orders).where(eq(orders.id, order.id));
    expect(paid?.status).toBe("paid");

    const again = await reconcilePayments(api.db, gateways, NO_SUBSCRIPTION_HOOKS, later);
    expect(again.applied).toBe(0);
  });

  it("an unreachable provider is skipped and retried next run", async () => {
    const { payment } = await openOrder();
    const fake = createFakeGateway("secret");
    fake.unavailable = true;
    const later = new Date(Date.now() + RECONCILE_QUIET_MS + 60_000);
    const result = await reconcilePayments(
      api.db,
      (key) => Promise.resolve(key === "fake" ? fake : null),
      NO_SUBSCRIPTION_HOOKS,
      later,
    );
    expect(result.unavailable).toBeGreaterThanOrEqual(1);
    const [row] = await owner.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row?.status).toBe("awaiting_customer");
  });

  it("a failure reported by the provider marks the attempt failed", async () => {
    const { payment } = await openOrder();
    const fake = createFakeGateway("secret");
    fake.statuses.set(payment.id, {
      paymentId: payment.id,
      providerRef: null,
      state: "failed",
      amountMinor: null,
      currency: null,
      failureCode: "declined",
    });
    const later = new Date(Date.now() + RECONCILE_QUIET_MS + 60_000);
    await reconcilePayments(
      api.db,
      (key) => Promise.resolve(key === "fake" ? fake : null),
      NO_SUBSCRIPTION_HOOKS,
      later,
    );
    const [row] = await owner.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row?.status).toBe("failed");
  });
});

describe("outbox: billing.order_paid", () => {
  it("writes one notification and queues one receipt per paid order", async () => {
    const { user, order, payment } = await openOrder();
    const fake = createFakeGateway("secret");
    fake.statuses.set(payment.id, {
      paymentId: payment.id,
      providerRef: `fake_${payment.id}`,
      state: "succeeded",
      amountMinor: 7_900,
      currency: "EGP",
      failureCode: null,
    });
    await reconcilePayments(
      api.db,
      (key) => Promise.resolve(key === "fake" ? fake : null),
      NO_SUBSCRIPTION_HOOKS,
      new Date(Date.now() + RECONCILE_QUIET_MS + 60_000),
    );

    const mails: Array<{ payload: EmailSendInput; jobId: string }> = [];
    const handlers = outboxHandlers({
      webOrigin: "https://wasfa.online",
      enqueueEmail: (payload, jobId) => {
        mails.push({ payload, jobId });
        return Promise.resolve();
      },
    });
    await drainOutbox(api.db, handlers);
    await drainOutbox(api.db, handlers);

    const notes = await owner.db
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, user.id));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe("billing.order_paid");
    const receipts = mails.filter((mail) => mail.payload.to === user.email);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.payload).toMatchObject({
      template: "payment_receipt",
      orderNumber: order.number,
      totalMinor: 7_900,
      link: `https://wasfa.online/billing/orders/${order.id}`,
    });
    const [entry] = await owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `order_paid:${order.id}`));
    expect(entry?.processedAt).not.toBeNull();
    expect(receipts[0]?.jobId).toBe(`outbox-${entry?.id ?? ""}`);
  });
});
