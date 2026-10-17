import {
  NO_SUBSCRIPTION_HOOKS,
  attachCheckout,
  createDb,
  createOrder,
  creditPacks,
  paymentGateways,
  drainOutbox,
  orders,
  outbox,
  payments,
  seedDefaults,
  userNotifications,
  users,
} from "@wasfa/db";
import { decodeEncryptionKey, encryptSecret } from "@wasfa/shared/crypto";
import { createFakeGateway, gatewayCredentialsContext } from "@wasfa/shared/gateways";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { outboxHandlers } from "../src/jobs/outbox.job.js";
import { RECONCILE_QUIET_MS, reconcilePayments } from "../src/jobs/payments.job.js";
import { createPaymentsRuntime } from "../src/payments/runtime.js";

import { TEST_ENCRYPTION_KEY, testEnv } from "./support/env.js";
import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startRedis, type TestRedis } from "./support/redis.js";

import type { EmailSendInput } from "@wasfa/shared/email";

/*
 * Reconciliation and the receipt outbox (Task 3.3), run as the restricted `wasfa_api` role the
 * worker uses in production: payment_events is insert-only for it, and the order sequence must
 * be usable.
 */

let postgres: TestPostgres;
let redisServer: TestRedis;
let owner: ReturnType<typeof createDb>;
let api: ReturnType<typeof createDb>;
let redis: Redis;
let packId: string;
let counter = 0;

beforeAll(async () => {
  [postgres, redisServer] = await Promise.all([startPostgres(), startRedis()]);
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  api = createDb({ url: postgres.apiUrl, max: 4 });
  redis = new Redis(redisServer.url, { maxRetriesPerRequest: null });
  await seedDefaults(owner.db);
  const [pack] = await owner.db.select().from(creditPacks).limit(1);
  if (!pack) throw new Error("no pack seeded");
  packId = pack.id;
}, 180_000);

afterAll(async () => {
  await api?.close();
  await owner?.close();
  await redis?.quit();
  await redisServer?.stop();
  await postgres?.stop();
});

async function openOrder(gateway: "fake" | "kashier" = "fake") {
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
      method: { key: gateway === "fake" ? "fake_card" : "kashier_card", gateway },
    },
    NO_SUBSCRIPTION_HOOKS,
  );
  if (!created.payment) throw new Error("expected a payment");
  const payment = await attachCheckout(api.db, created.payment.id, `fake_${created.payment.id}`);
  return { user, order: created.order, payment };
}

describe("payments.reconcile", () => {
  it("reconciles an open payment through a configured gateway that is disabled", async () => {
    const credentials = {
      merchantId: "MID-123-456",
      paymentApiKey: "made-up-payment-api-key",
      secretKey: "made-up-secret-key",
    };
    await owner.db.insert(paymentGateways).values({
      key: "kashier",
      provider: "kashier",
      mode: "test",
      credentialsEnc: encryptSecret(
        JSON.stringify(credentials),
        decodeEncryptionKey(TEST_ENCRYPTION_KEY),
        gatewayCredentialsContext("kashier"),
      ),
      merchantRef: credentials.merchantId,
      keyHint: "…-key",
      credentialsUpdatedAt: new Date(),
      enabled: true,
    });
    const { order } = await openOrder("kashier");
    await owner.db
      .update(paymentGateways)
      .set({ enabled: false })
      .where(eq(paymentGateways.key, "kashier"));
    const runtime = createPaymentsRuntime(testEnv(redisServer.url), api.db, redis);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        response: {
          status: "CAPTURED",
          order: { amount: "79.00", currency: "EGP" },
          orderId: "made-up-provider-order",
        },
      }),
    );
    try {
      const result = await reconcilePayments(
        api.db,
        (key) => runtime.gateway(key),
        NO_SUBSCRIPTION_HOOKS,
        new Date(Date.now() + RECONCILE_QUIET_MS + 60_000),
      );
      expect(result.applied).toBe(1);
      const [paid] = await owner.db.select().from(orders).where(eq(orders.id, order.id));
      expect(paid?.status).toBe("paid");
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      fetchMock.mockRestore();
      await runtime.close();
    }
  });

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
      enqueueAlertDelivery: () => Promise.resolve(),
      enqueueAlertDigest: () => Promise.resolve(),
    });
    // Postgres stamps `available_at` in microseconds, `new Date()` in milliseconds: drain a second
    // ahead so an entry inserted in the same millisecond is already due.
    const drainAt = new Date(Date.now() + 1_000);
    await drainOutbox(api.db, handlers, drainAt);
    await drainOutbox(api.db, handlers, drainAt);

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
