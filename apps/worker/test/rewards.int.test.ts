import { randomUUID } from "node:crypto";

import {
  adminAlerts,
  attributeReferral,
  createDb,
  creditWallets,
  drainOutbox,
  ensureReferralCode,
  orders,
  organizations,
  outbox,
  payments,
  plans,
  pointsWallets,
  referrals,
  rxAnalyses,
  seedDefaults,
  siteSettings,
  users,
} from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "@wasfa/shared/crypto";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { outboxHandlers } from "../src/jobs/outbox.job.js";
import { reconcileRewardsJob, releaseRewardsJob } from "../src/jobs/rewards.job.js";
import { HANDLERS } from "../src/queues.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

/*
 * Rewards on the worker, as the restricted `wasfa_api` role (the role the worker runs as): the
 * outbox topics, the hourly release and the nightly reconcile with its alert.
 */

const logger = pino({ level: "silent" });
const DAY = 86_400_000;
const KEY = Buffer.alloc(32, 7);
let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let seq = 0;

const sealed = (phone: string, paymentId: string) =>
  encryptSecret(
    phone,
    decodeEncryptionKey(KEY.toString("base64")),
    `payment.sender_phone:${paymentId}`,
  );

const runtime = {
  webOrigin: "https://wasfa.example",
  enqueueEmail: () => Promise.resolve(),
  enqueueAlertDelivery: () => Promise.resolve(),
  enqueueAlertDigest: () => Promise.resolve(),
};
const drain = () => drainOutbox(worker.db, outboxHandlers(runtime), new Date(), 100);

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 2 });
  await seedDefaults(owner.db);
  await owner.db
    .insert(siteSettings)
    .values({ key: "rewards", value: { enabled: true } })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: { enabled: true } } });
}, 180_000);

afterAll(async () => {
  await owner?.close();
  await worker?.close();
  await postgres?.stop();
});

async function newUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await owner.db
    .insert(users)
    .values({
      name: "Omar Friend",
      email: `w${String(++seq)}-${randomUUID().slice(0, 6)}@example.com`,
      ...values,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

async function referredPair() {
  const referrerId = await newUser({ name: "Rana Referrer" });
  const refereeId = await newUser();
  const code = await ensureReferralCode(owner.db, referrerId);
  const referral = await attributeReferral(owner.db, {
    refereeUserId: refereeId,
    code: code.code,
    source: "link",
  });
  if (!referral) throw new Error("attribution failed");
  return { referrerId, refereeId, referral };
}

async function paidSubscription(userId: string, subtotalMinor = 10_000) {
  const [plus] = await owner.db.select().from(plans).where(eq(plans.key, "plus"));
  if (!plus) throw new Error("plan missing");
  const [order] = await owner.db
    .insert(orders)
    .values({
      ownerUserId: userId,
      kind: "subscription",
      planId: plus.id,
      months: 1,
      currency: "EGP",
      quote: {},
      quoteHash: "a".repeat(64),
      subtotalMinor,
      totalMinor: subtotalMinor,
      status: "paid",
      paymentKind: "gateway",
      expiresAt: new Date(Date.now() + DAY),
      paidAt: new Date(),
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  return order;
}

const queue = (topic: string, payload: Record<string, unknown>, key: string) =>
  owner.db.insert(outbox).values({ topic, payload, idempotencyKey: key });

const wallet = async (userId: string) =>
  (await owner.db.select().from(pointsWallets).where(eq(pointsWallets.userId, userId)))[0];

describe("outbox topics", () => {
  it("rewards.signup_check pays the sign-up rules only when everything is in place", async () => {
    const { referrerId, refereeId } = await referredPair();
    await queue("rewards.signup_check", { userId: refereeId }, `t:${randomUUID()}`);
    await drain();
    expect(await wallet(referrerId)).toBeUndefined();

    await owner.db
      .update(users)
      .set({
        emailVerified: true,
        phone: "+201066660001",
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
      })
      .where(eq(users.id, refereeId));
    await owner.db.insert(rxAnalyses).values({
      ownerUserId: refereeId,
      createdBy: refereeId,
      status: "done",
      mode: "fast",
      skillVersion: "t@1",
    });
    await queue("rewards.signup_check", { userId: refereeId }, `t:${randomUUID()}`);
    await queue("rewards.signup_check", { userId: refereeId }, `t:${randomUUID()}`);
    const result = await drain();
    expect(result).toMatchObject({ processed: 2, failed: 0 });
    expect(await wallet(referrerId)).toMatchObject({ pending: 50 });
    const [credits] = await owner.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, refereeId));
    expect(credits?.balance).toBe(20);
  });

  it("rewards.order_paid then rewards.order_refunded: pending points, then reversed", async () => {
    const { referrerId, refereeId } = await referredPair();
    const order = await paidSubscription(refereeId);
    await queue("rewards.order_paid", { orderId: order.id }, `rewards_order_paid:${order.id}`);
    await drain();
    expect(await wallet(referrerId)).toMatchObject({ pending: 200 });

    await owner.db.update(orders).set({ status: "refunded" }).where(eq(orders.id, order.id));
    const refundId = randomUUID();
    await queue(
      "rewards.order_refunded",
      { orderId: order.id, refundId },
      `rewards_order_refunded:${refundId}`,
    );
    await drain();
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 0 });
  });

  it("a failing handler is retried, not lost: a malformed payload parks nothing as processed", async () => {
    const entryKey = `bad:${randomUUID()}`;
    await queue("rewards.order_paid", { orderId: "not-a-uuid" }, entryKey);
    const result = await drain();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const [row] = await owner.db.select().from(outbox).where(eq(outbox.idempotencyKey, entryKey));
    expect(row?.processedAt).toBeNull();
    expect(row?.attempts).toBe(1);
    // Leave the queue clean for the next test.
    await owner.db.delete(outbox).where(eq(outbox.idempotencyKey, entryKey));
  });

  it("orgs.member_joined evaluates the organization-join rule of a referred member", async () => {
    const { referrerId, refereeId } = await referredPair();
    const [org] = await owner.db
      .insert(organizations)
      .values({ name: "Al-Nour Pharmacy", type: "pharmacy", country: "EG", createdBy: referrerId })
      .returning({ id: organizations.id });
    if (!org) throw new Error("org insert failed");
    await queue(
      "orgs.member_joined",
      { orgId: org.id, userId: refereeId, linkId: null },
      `orgs.member_joined:${org.id}:${refereeId}`,
    );
    const result = await drain();
    // No standard rule pays for joining, so nothing is granted, and the entry is consumed, not parked.
    expect(result).toMatchObject({ failed: 0, parked: 0 });
    expect(await wallet(referrerId)).toBeUndefined();
  });

  it("sender numbers are opened with the payment id as context and the same payer is held", async () => {
    const phone = "+201077770001";
    const referrerId = await newUser({ name: "Rana Referrer", phone });
    const refereeId = await newUser();
    const code = await ensureReferralCode(owner.db, referrerId);
    await attributeReferral(owner.db, {
      refereeUserId: refereeId,
      code: code.code,
      source: "link",
    });
    const order = await paidSubscription(refereeId);
    const [payment] = await owner.db
      .insert(payments)
      .values({
        orderId: order.id,
        reference: `WSP-${randomUUID().slice(0, 8)}`,
        methodKey: "instapay",
        status: "succeeded",
        amountMinor: order.totalMinor,
        currency: "EGP",
        senderPhoneMasked: "010*****001",
        senderPhoneEnc: "x",
      })
      .returning();
    if (!payment) throw new Error("payment insert failed");
    await owner.db
      .update(payments)
      .set({ senderPhoneEnc: sealed("01077770001", payment.id) })
      .where(eq(payments.id, payment.id));
    await queue("rewards.order_paid", { orderId: order.id }, `rewards_order_paid:${order.id}`);
    const withKey = outboxHandlers(runtime, {
      openSenderPhone: (value, paymentId) => {
        try {
          return decryptSecret(value, KEY, `payment.sender_phone:${paymentId}`);
        } catch {
          return null;
        }
      },
    });
    await drainOutbox(worker.db, withKey, new Date(), 100);
    const [row] = await owner.db
      .select()
      .from(referrals)
      .where(eq(referrals.refereeUserId, refereeId));
    expect(row).toMatchObject({ status: "held" });
    expect(row?.flags).toContain("same_payer");
  });
});

describe("rewards.release", () => {
  it("releases what is due on the supplied clock and leaves the rest", async () => {
    const { referrerId, refereeId } = await referredPair();
    const order = await paidSubscription(refereeId, 29_900);
    await queue("rewards.order_paid", { orderId: order.id }, `rewards_order_paid:${order.id}`);
    await drain();
    await releaseRewardsJob({}, { db: worker.db, logger }, new Date(Date.now() + 13 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 598, cash: 0 });
    await releaseRewardsJob({}, { db: worker.db, logger }, new Date(Date.now() + 15 * DAY));
    expect(await wallet(referrerId)).toMatchObject({ pending: 0, cash: 598 });
    expect(HANDLERS.payments["rewards.release"]).toBe(releaseRewardsJob);
    expect(HANDLERS.payments["rewards.reconcile"]).toBe(reconcileRewardsJob);
  });
});

describe("rewards.reconcile", () => {
  it("is quiet when the ledger adds up and raises one critical alert on drift", async () => {
    const before = await owner.db
      .select()
      .from(adminAlerts)
      .where(eq(adminAlerts.kind, "points.reconcile_drift"));
    await reconcileRewardsJob({}, { db: worker.db, logger });
    expect(
      await owner.db
        .select()
        .from(adminAlerts)
        .where(eq(adminAlerts.kind, "points.reconcile_drift")),
    ).toHaveLength(before.length);

    const victim = await newUser();
    await owner.db.insert(pointsWallets).values({ userId: victim, cash: 9 });
    await reconcileRewardsJob({}, { db: worker.db, logger });
    const alerts = await owner.db
      .select()
      .from(adminAlerts)
      .where(eq(adminAlerts.kind, "points.reconcile_drift"));
    expect(alerts).toHaveLength(before.length + 1);
    expect(alerts.at(-1)).toMatchObject({ severity: "critical" });
    expect(alerts.at(-1)?.summary).toMatch(/1 of \d+ wallets/);

    // The fan-out is queued with the alert.
    const fanOut = await owner.db.select().from(outbox).where(eq(outbox.topic, "alerts.fan_out"));
    expect(fanOut.length).toBeGreaterThan(0);
    await owner.db.update(pointsWallets).set({ cash: 0 }).where(eq(pointsWallets.userId, victim));
  });
});
