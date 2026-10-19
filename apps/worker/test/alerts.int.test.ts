import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  adminAlertPrefs,
  adminAlerts,
  alertDeliveries,
  auditLogs,
  creditPacks,
  createDb,
  createOrder,
  drainOutbox,
  files,
  outbox,
  paymentEvents,
  paymentMethodAccountChanges,
  paymentMethods,
  raiseAdminAlert,
  runMigrations,
  seedDefaults,
  siteSettings,
  submitManualProof,
  NO_SUBSCRIPTION_HOOKS,
  userRoles,
  users,
} from "@wasfa/db";
import { isSafeAlertSummary } from "@wasfa/shared/alert-safety";
import { and, eq, inArray } from "drizzle-orm";
import { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { alertDeliveryJob } from "../src/alerts/alert-delivery.job.js";
import { alertDigestJob } from "../src/alerts/alert-digest.job.js";
import { pendingDeliverySweepJob } from "../src/alerts/pending-delivery-sweep.job.js";
import { WA_ALERT_OPTIN_JIDS, processAlertOptIn } from "../src/alerts/wa-optins.loop.js";
import { outboxHandlers } from "../src/jobs/outbox.job.js";
import { applyDuePaymentMethodChangesJob } from "../src/jobs/payment-method-account-changes.job.js";
import { paymentsReviewSlaJob } from "../src/jobs/payments-review-sla.job.js";
import { createEmailRuntime } from "../src/notifications/email.js";

import { testEnv } from "./support/env.js";
import { startRedis, type TestRedis } from "./support/redis.js";

import type { PaymentsRuntime } from "../src/payments/runtime.js";
import type { OutboxPostCommitAction } from "@wasfa/db";

let postgres: StartedPostgreSqlContainer;
let redisInfra: TestRedis;
let db: ReturnType<typeof createDb>;
let redis: Redis;
let emailRuntime: ReturnType<typeof createEmailRuntime>;
let adminId: string;
let financeAdminId: string;
let packId: string;
let methodKey: string;
const logger = pino({ level: "silent" });

beforeAll(async () => {
  [postgres, redisInfra] = await Promise.all([
    new PostgreSqlContainer("postgres:18-alpine").start(),
    startRedis(),
  ]);
  db = createDb({ url: postgres.getConnectionUri(), max: 3 });
  redis = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
  await runMigrations(db.db);
  await seedDefaults(db.db);
  const [pack] = await db.db.select().from(creditPacks).limit(1);
  if (!pack) throw new Error("credit pack missing");
  packId = pack.id;
  methodKey = `instapay${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await db.db.insert(paymentMethods).values({
    key: methodKey,
    kind: "manual",
    provider: "instapay",
    nameAr: "InstaPay",
    nameEn: "InstaPay",
    instructionsAr: "{amount} {account}",
    instructionsEn: "{amount} {account}",
    accountDisplay: "merchant@example",
    currencies: ["EGP"],
    requiresProof: true,
    enabled: true,
  });
  const [admin] = await db.db
    .insert(users)
    .values({ name: "Alerts Admin", email: "alerts-admin@example.com", locale: "en" })
    .returning();
  if (!admin) throw new Error("admin insert failed");
  adminId = admin.id;
  await db.db.insert(userRoles).values({ userId: adminId, roleKey: "super_admin" });
  const [financeAdmin] = await db.db
    .insert(users)
    .values({ name: "Finance Alerts Admin", email: "finance-alerts@example.com", locale: "en" })
    .returning();
  if (!financeAdmin) throw new Error("finance admin insert failed");
  financeAdminId = financeAdmin.id;
  await db.db.insert(userRoles).values({ userId: financeAdminId, roleKey: "finance" });
  await db.db.insert(adminAlertPrefs).values({
    userId: adminId,
    inAppEnabled: true,
    emailEnabled: true,
    telegramEnabled: true,
    telegramChatId: "12345",
    whatsappEnabled: false,
  });
  await db.db.insert(adminAlertPrefs).values({
    userId: financeAdminId,
    inAppEnabled: true,
    emailEnabled: false,
    telegramEnabled: false,
    whatsappEnabled: false,
    mutedKinds: ["payment.review_needed"],
  });
  emailRuntime = createEmailRuntime(
    testEnv(redisInfra.url, {
      ALERT_TELEGRAM_BOT_TOKEN: "123456:stub-token",
      WEB_ORIGIN: "https://wasfa.example",
    }),
    redis,
    logger,
  );
}, 180_000);

afterAll(async () => {
  await emailRuntime?.transport.close();
  await redis?.quit();
  await db?.close();
  await Promise.all([postgres?.stop(), redisInfra?.stop()]);
});

describe("admin alert fan-out", () => {
  it("commits in-app and Telegram delivery rows before a Telegram stub sends", async () => {
    const latencies: number[] = [];
    const fetchStub = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    const runtime = {
      webOrigin: "https://wasfa.example",
      enqueueEmail: async () => undefined,
      enqueueAlertDelivery: async () => undefined,
      enqueueAlertDigest: async () => undefined,
    };
    const fanOut = outboxHandlers(runtime)["alerts.fan_out"];
    if (!fanOut) throw new Error("fan-out handler missing");
    try {
      for (let run = 0; run < 5; run++) {
        await db.db.delete(alertDeliveries);
        const [buyer] = await db.db
          .insert(users)
          .values({ name: "Proof Buyer", email: `proof-buyer-${run}@example.com` })
          .returning();
        if (!buyer) throw new Error("buyer insert failed");
        const orderResult = await createOrder(
          db.db,
          {
            owner: { type: "user", id: buyer.id },
            kind: "credit_pack",
            planId: null,
            packId,
            months: null,
            currency: "EGP",
            quote: { grants: {} },
            quoteHash: "a".repeat(64),
            subtotalMinor: 7_900,
            discountMinor: 0,
            taxMinor: 0,
            feeMinor: 0,
            totalMinor: 7_900,
            applied: {},
            expiresAt: new Date(Date.now() + 60 * 60_000),
            method: { key: methodKey, gateway: null },
          },
          NO_SUBSCRIPTION_HOOKS,
        );
        if (!orderResult.payment) throw new Error("manual payment missing");
        const [proof] = await db.db
          .insert(files)
          .values({
            ownerUserId: buyer.id,
            createdBy: buyer.id,
            purpose: "payment_proof",
            r2Key: `proof-${randomUUID()}`,
            mime: "image/jpeg",
            bytes: 1_024,
            status: "processed",
            sha256: "a".repeat(64),
            dhash: "0123456789abcdef",
          })
          .returning();
        if (!proof) throw new Error("proof insert failed");
        const started = performance.now();
        const submission = await submitManualProof(db.db, {
          userId: buyer.id,
          paymentId: orderResult.payment.id,
          txnId: `TXN-${run}-${randomUUID().slice(0, 8)}`,
          senderPhoneMasked: "010*****678",
          senderPhoneEnc: "sealed-test-phone",
          fileId: proof.id,
        });
        if (!submission.alertId) throw new Error("review alert was not created");
        const [entry] = await db.db
          .select()
          .from(outbox)
          .where(eq(outbox.idempotencyKey, `alert:${submission.alertId}`));
        if (!entry) throw new Error("outbox insert failed");

        const actionResult = await db.db.transaction((tx) => fanOut(tx, entry));
        const actions = Array.isArray(actionResult)
          ? (actionResult as OutboxPostCommitAction[])
          : [];
        await db.db.transaction((tx) => fanOut(tx, entry));
        const rows = await db.db
          .select()
          .from(alertDeliveries)
          .where(eq(alertDeliveries.alertId, submission.alertId));
        expect(rows).toHaveLength(run === 0 ? 3 : 4);
        const inApp = rows.find((row) => row.channel === "in_app");
        const telegram = rows.find((row) => row.channel === "telegram");
        expect(inApp?.status).toBe("sent");
        expect(telegram?.status).toBe("pending");
        expect(actions ?? []).toHaveLength(2);
        const financeInApp = rows.find((row) => row.adminUserId === financeAdminId);
        if (run === 0) {
          expect(financeInApp).toBeUndefined();
        } else {
          expect(financeInApp?.channel).toBe("in_app");
          expect(rows.filter((row) => row.adminUserId === financeAdminId)).toHaveLength(1);
        }

        if (!telegram) throw new Error("telegram delivery missing");
        await alertDeliveryJob(
          { deliveryId: telegram.id },
          {
            db: db.db,
            redis,
            logger,
            email: emailRuntime,
            env: testEnv(redisInfra.url, {
              ALERT_TELEGRAM_BOT_TOKEN: "123456:stub-token",
              WEB_ORIGIN: "https://wasfa.example",
            }),
          },
        );
        const sent = await db.db
          .select()
          .from(alertDeliveries)
          .where(eq(alertDeliveries.id, telegram.id));
        expect(sent[0]?.status).toBe("sent");
        latencies.push(performance.now() - started);
      }
    } finally {
      fetchStub.mockRestore();
    }
    latencies.sort((left, right) => left - right);
    const medianMs = latencies[2];
    if (medianMs === undefined) throw new Error("latency measurement missing");
    expect(medianMs).toBeLessThan(10_000);
    process.stdout.write(`alert_submit_to_delivery_median_ms=${medianMs?.toFixed(2)}\n`);
  }, 60_000);

  it("throttles a three-alert burst into one immediate Telegram delivery and a digest window", async () => {
    await db.db.delete(alertDeliveries);
    await db.db
      .update(adminAlertPrefs)
      .set({ emailEnabled: false })
      .where(eq(adminAlertPrefs.userId, adminId));
    const runtime = {
      webOrigin: "https://wasfa.example",
      enqueueEmail: async () => undefined,
      enqueueAlertDelivery: async () => undefined,
      enqueueAlertDigest: async () => undefined,
    };
    const fanOut = outboxHandlers(runtime)["alerts.fan_out"];
    if (!fanOut) throw new Error("fan-out handler missing");
    const actions: OutboxPostCommitAction[] = [];
    for (let index = 0; index < 3; index++) {
      const alertId = await raiseAdminAlert(db.db, {
        kind: "payment.review_overdue",
        severity: "warning",
        refType: "payment",
        refId: randomUUID(),
        summary: `Order WSO-2026-00${index + 1}: payment review overdue.`,
        link: "/admin/billing/payments",
      });
      const [entry] = await db.db
        .select()
        .from(outbox)
        .where(eq(outbox.idempotencyKey, `alert:${alertId}`));
      if (!entry) throw new Error("alert outbox row missing");
      const created = await db.db.transaction((tx) => fanOut(tx, entry));
      if (Array.isArray(created)) actions.push(...(created as OutboxPostCommitAction[]));
    }
    const telegramRows = await db.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.channel, "telegram"));
    expect(telegramRows).toHaveLength(3);
    expect(telegramRows.filter((row) => row.error === "digest_pending")).toHaveLength(2);
    expect(actions.filter((action) => action.kind === "alert_delivery")).toHaveLength(1);
    const digests = actions.filter((action) => action.kind === "alert_digest");
    expect(digests).toHaveLength(2);
    expect(
      digests[0]?.kind === "alert_digest" && digests[1]?.kind === "alert_digest"
        ? digests[0].windowStart === digests[1].windowStart
        : false,
    ).toBe(true);
  });

  it("sends a test alert only to the admin who asked, unmuted and outside the digest window", async () => {
    // The burst above left an open Telegram window for this admin: a test must not wait for it.
    await db.db
      .update(adminAlertPrefs)
      .set({ mutedKinds: ["system.test"] })
      .where(eq(adminAlertPrefs.userId, adminId));
    const runtime = {
      webOrigin: "https://wasfa.example",
      enqueueEmail: async () => undefined,
      enqueueAlertDelivery: async () => undefined,
      enqueueAlertDigest: async () => undefined,
    };
    const fanOut = outboxHandlers(runtime)["alerts.fan_out"];
    if (!fanOut) throw new Error("fan-out handler missing");
    const alertId = await raiseAdminAlert(db.db, {
      kind: "system.test",
      severity: "info",
      refType: "user",
      refId: adminId,
      summary: "Test alert.",
      link: "/admin/notifications",
    });
    const [entry] = await db.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `alert:${alertId}`));
    if (!entry) throw new Error("alert outbox row missing");
    const created = await db.db.transaction((tx) => fanOut(tx, entry));
    const actions = (Array.isArray(created) ? created : []) as OutboxPostCommitAction[];
    const rows = await db.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.alertId, alertId));
    expect(new Set(rows.map((row) => row.adminUserId))).toEqual(new Set([adminId]));
    expect(rows.map((row) => row.channel).sort()).toEqual(["in_app", "telegram"]);
    expect(rows.find((row) => row.channel === "telegram")?.error).toBeNull();
    expect(actions.filter((action) => action.kind === "alert_delivery")).toHaveLength(1);
    expect(actions.filter((action) => action.kind === "alert_digest")).toHaveLength(0);
    await db.db
      .update(adminAlertPrefs)
      .set({ mutedKinds: [] })
      .where(eq(adminAlertPrefs.userId, adminId));
  });

  it("sweeps a digest whose post-commit enqueue failed and sends it after the window", async () => {
    await db.db.delete(alertDeliveries);
    const now = new Date();
    const windowStart = new Date(now.getTime() - 14 * 60_000);
    const [anchorAlertId, digestAlertId] = await Promise.all([
      raiseAdminAlert(db.db, {
        kind: "payment.review_overdue",
        severity: "warning",
        refType: "payment",
        refId: randomUUID(),
        summary: "An earlier manual payment review is overdue.",
        link: "/admin/billing/payments",
      }),
      raiseAdminAlert(db.db, {
        kind: "payment.review_overdue",
        severity: "warning",
        refType: "payment",
        refId: randomUUID(),
        summary: "Another manual payment review is overdue.",
        link: "/admin/billing/payments",
      }),
    ]);
    const digestCreatedAt = new Date(windowStart.getTime() + 60_000);
    await db.db
      .update(adminAlerts)
      .set({ createdAt: windowStart })
      .where(eq(adminAlerts.id, anchorAlertId));
    await db.db
      .update(adminAlerts)
      .set({ createdAt: digestCreatedAt })
      .where(eq(adminAlerts.id, digestAlertId));
    await db.db.insert(alertDeliveries).values([
      {
        alertId: anchorAlertId,
        adminUserId: adminId,
        channel: "telegram",
        status: "sent",
        sentAt: windowStart,
        createdAt: windowStart,
      },
      {
        alertId: digestAlertId,
        adminUserId: adminId,
        channel: "telegram",
        status: "pending",
        error: "digest_pending",
        createdAt: digestCreatedAt,
      },
    ]);
    await db.db.delete(outbox);
    const idempotencyKey = `digest-enqueue-${randomUUID()}`;
    await db.db.insert(outbox).values({
      topic: "test.digest_enqueue",
      payload: {},
      idempotencyKey,
    });
    const [entry] = await db.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, idempotencyKey));
    if (!entry) throw new Error("digest outbox row missing");
    const digestAction: OutboxPostCommitAction = {
      kind: "alert_digest",
      adminUserId: adminId,
      channel: "telegram",
      windowStart: windowStart.toISOString(),
      delayMs: 60_000,
    };
    await drainOutbox(
      db.db,
      { "test.digest_enqueue": async () => [digestAction] },
      now,
      1,
      async () => {
        throw new Error("simulated post-commit queue failure");
      },
    );

    let enqueued:
      | { adminUserId: string; channel: "email" | "telegram" | "whatsapp"; windowStart: string }
      | undefined;
    const payments = {
      enqueueAlertDelivery: async () => undefined,
      enqueueAlertDigest: async (input: {
        adminUserId: string;
        channel: "email" | "telegram" | "whatsapp";
        windowStart: string;
      }) => {
        enqueued = input;
      },
    };
    await pendingDeliverySweepJob(
      {},
      {
        db: db.db,
        redis,
        logger,
        email: emailRuntime,
        payments: payments as unknown as PaymentsRuntime,
      },
      now,
    );
    expect(enqueued).toEqual({
      adminUserId: adminId,
      channel: "telegram",
      windowStart: windowStart.toISOString(),
    });

    const fetchStub = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    try {
      await alertDigestJob(
        { adminUserId: adminId, channel: "telegram", windowStart: windowStart.toISOString() },
        {
          db: db.db,
          redis,
          logger,
          email: emailRuntime,
          env: testEnv(redisInfra.url, { ALERT_TELEGRAM_BOT_TOKEN: "123456:stub-token" }),
        },
      );
    } finally {
      fetchStub.mockRestore();
    }
    const [sent] = await db.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.alertId, digestAlertId));
    expect(sent?.status).toBe("sent");
  }, 60_000);
});

/** A manual credit-pack payment of a fresh buyer, moved to `awaiting_review` with a proof. */
async function paymentUnderReview(label: string): Promise<{ paymentId: string; txnId: string }> {
  const [buyer] = await db.db
    .insert(users)
    .values({ name: `Buyer ${label}`, email: `${label}-${randomUUID()}@example.com` })
    .returning();
  if (!buyer) throw new Error("buyer insert failed");
  const created = await createOrder(
    db.db,
    {
      owner: { type: "user", id: buyer.id },
      kind: "credit_pack",
      planId: null,
      packId,
      months: null,
      currency: "EGP",
      quote: { grants: {} },
      quoteHash: "b".repeat(64),
      subtotalMinor: 7_900,
      discountMinor: 0,
      taxMinor: 0,
      feeMinor: 0,
      totalMinor: 7_900,
      applied: {},
      expiresAt: new Date(Date.now() + 60 * 60_000),
      method: { key: methodKey, gateway: null },
    },
    NO_SUBSCRIPTION_HOOKS,
  );
  if (!created.payment) throw new Error("manual payment missing");
  const [proof] = await db.db
    .insert(files)
    .values({
      ownerUserId: buyer.id,
      createdBy: buyer.id,
      purpose: "payment_proof",
      r2Key: `proof-${randomUUID()}`,
      mime: "image/jpeg",
      bytes: 1_024,
      status: "processed",
      sha256: randomUUID().replaceAll("-", "").padEnd(64, "c"),
      dhash: "fedcba9876543210",
    })
    .returning();
  if (!proof) throw new Error("proof insert failed");
  const txnId = `TXN-${label.toUpperCase()}-${randomUUID().slice(0, 8)}`;
  await submitManualProof(db.db, {
    userId: buyer.id,
    paymentId: created.payment.id,
    txnId,
    senderPhoneMasked: "012*****678",
    senderPhoneEnc: "sealed-test-phone",
    fileId: proof.id,
  });
  return { paymentId: created.payment.id, txnId };
}

async function setAlertsSetting(value: Record<string, unknown> | null): Promise<void> {
  await db.db.delete(siteSettings).where(eq(siteSettings.key, "alerts"));
  if (value) await db.db.insert(siteSettings).values({ key: "alerts", value });
}

describe("review SLA reminders", () => {
  // 13:05 and 13:35 in Cairo (UTC+3 in October), inside the default 09:00-22:00 business hours.
  const inside = new Date("2026-10-14T10:05:00Z");
  const nextSlot = new Date("2026-10-14T10:35:00Z");
  // 00:05 in Cairo.
  const outside = new Date("2026-10-14T21:05:00Z");

  async function overdueAlerts(paymentId: string) {
    return db.db
      .select()
      .from(adminAlerts)
      .where(and(eq(adminAlerts.kind, "payment.review_overdue"), eq(adminAlerts.refId, paymentId)));
  }

  it("reminds once per 30-minute slot, only inside business hours, honouring the method SLA", async () => {
    await setAlertsSetting(null);
    const { paymentId } = await paymentUnderReview("sla");
    // Entered review three hours before the simulated clock: past the 120-minute default SLA.
    await db.db
      .update(paymentEvents)
      .set({ receivedAt: new Date(inside.getTime() - 3 * 60 * 60_000) })
      .where(eq(paymentEvents.paymentId, paymentId));

    await paymentsReviewSlaJob({}, { db: db.db }, outside);
    expect(await overdueAlerts(paymentId)).toHaveLength(0);

    await paymentsReviewSlaJob({}, { db: db.db }, inside);
    await paymentsReviewSlaJob({}, { db: db.db }, new Date(inside.getTime() + 60_000));
    expect(await overdueAlerts(paymentId)).toHaveLength(1);

    await paymentsReviewSlaJob({}, { db: db.db }, nextSlot);
    expect(await overdueAlerts(paymentId)).toHaveLength(2);

    // A method with a longer SLA (10 h) is not overdue after 4 h.
    await db.db
      .update(paymentMethods)
      .set({ reviewSlaMinutes: 600 })
      .where(eq(paymentMethods.key, methodKey));
    try {
      await paymentsReviewSlaJob({}, { db: db.db }, new Date("2026-10-14T11:05:00Z"));
      expect(await overdueAlerts(paymentId)).toHaveLength(2);
    } finally {
      await db.db
        .update(paymentMethods)
        .set({ reviewSlaMinutes: null })
        .where(eq(paymentMethods.key, methodKey));
    }
  });
});

describe("WhatsApp alert channel", () => {
  const adminDigits = "201098765432";
  const adminJid = `${adminDigits}@s.whatsapp.net`;
  let waAdminId: string;

  async function whatsappDelivery(summary: string) {
    const alertId = await raiseAdminAlert(db.db, {
      kind: "payment.review_needed",
      severity: "critical",
      refType: "payment",
      refId: randomUUID(),
      summary,
      link: "/admin/billing/payments",
    });
    const [delivery] = await db.db
      .insert(alertDeliveries)
      .values({ alertId, adminUserId: waAdminId, channel: "whatsapp", status: "pending" })
      .returning();
    if (!delivery) throw new Error("delivery insert failed");
    return delivery.id;
  }

  async function deliver(deliveryId: string) {
    await alertDeliveryJob(
      { deliveryId },
      {
        db: db.db,
        redis,
        logger,
        email: emailRuntime,
        env: testEnv(redisInfra.url, { WEB_ORIGIN: "https://wasfa.example" }),
      },
    );
    const [row] = await db.db
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.id, deliveryId));
    return row;
  }

  beforeAll(async () => {
    const [admin] = await db.db
      .insert(users)
      .values({
        name: "WhatsApp Admin",
        email: `wa-admin-${randomUUID()}@example.com`,
        phone: `+${adminDigits}`,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
      })
      .returning();
    if (!admin) throw new Error("admin insert failed");
    waAdminId = admin.id;
    await db.db.insert(userRoles).values({ userId: waAdminId, roleKey: "finance" });
  });

  it("links only a verified admin phone, ignores others and malformed entries, and opts out", async () => {
    await db.db.insert(users).values({
      name: "Plain Customer",
      email: `wa-customer-${randomUUID()}@example.com`,
      phone: "+201011112222",
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    });
    const customer = JSON.stringify({
      action: "optin",
      digits: "201011112222",
      jid: "201011112222@s.whatsapp.net",
    });
    expect(await processAlertOptIn(db.db, redis, customer)).toBe("ignored");
    expect(await redis.sismember(WA_ALERT_OPTIN_JIDS, "201011112222@s.whatsapp.net")).toBe(0);
    expect(await processAlertOptIn(db.db, redis, "{not json")).toBe("ignored");
    expect(await processAlertOptIn(db.db, redis, JSON.stringify({ action: "optin" }))).toBe(
      "ignored",
    );

    const optIn = JSON.stringify({ action: "optin", digits: adminDigits, jid: adminJid });
    expect(await processAlertOptIn(db.db, redis, optIn)).toBe("opted_in");
    const [prefs] = await db.db
      .select()
      .from(adminAlertPrefs)
      .where(eq(adminAlertPrefs.userId, waAdminId));
    expect(prefs).toMatchObject({ whatsappEnabled: true, whatsappJid: adminJid });
    expect(await redis.sismember(WA_ALERT_OPTIN_JIDS, adminJid)).toBe(1);

    const optOut = JSON.stringify({ action: "optout", digits: adminDigits, jid: adminJid });
    expect(await processAlertOptIn(db.db, redis, optOut)).toBe("opted_out");
    const [cleared] = await db.db
      .select()
      .from(adminAlertPrefs)
      .where(eq(adminAlertPrefs.userId, waAdminId));
    expect(cleared).toMatchObject({ whatsappEnabled: false, whatsappJid: null });
    expect(await redis.sismember(WA_ALERT_OPTIN_JIDS, adminJid)).toBe(0);
  });

  it("is off by default, pushes only for opted-in admins when on, without links, and stops at the daily cap", async () => {
    await redis.del("wa:alerts");
    await processAlertOptIn(
      db.db,
      redis,
      JSON.stringify({ action: "optin", digits: adminDigits, jid: adminJid }),
    );

    await setAlertsSetting(null);
    const off = await deliver(await whatsappDelivery("Order WSO-2026-000901 needs review."));
    expect(off).toMatchObject({ status: "skipped", error: "disabled" });
    expect(await redis.llen("wa:alerts")).toBe(0);

    await setAlertsSetting({ whatsapp: { enabled: true, dailyCap: 20 } });
    try {
      const on = await deliver(await whatsappDelivery("Order WSO-2026-000902 needs review."));
      expect(on?.status).toBe("sent");
      const pushed = await redis.lrange("wa:alerts", 0, -1);
      expect(pushed).toHaveLength(1);
      const payload = JSON.parse(pushed[0] ?? "{}") as { jid: string; text: string };
      expect(payload.jid).toBe(adminJid);
      expect(payload.text).not.toMatch(/https?:|www\./);

      // Not in the opt-in set any more: skipped, nothing pushed.
      await redis.srem(WA_ALERT_OPTIN_JIDS, adminJid);
      const notOptedIn = await deliver(await whatsappDelivery("Order WSO-2026-000903."));
      expect(notOptedIn).toMatchObject({ status: "skipped", error: "not_opted_in" });
      await redis.sadd(WA_ALERT_OPTIN_JIDS, adminJid);

      // The cap counts every admin's WhatsApp sends today: with 20 out, the next is refused.
      const sentToday = await db.db
        .select({ id: alertDeliveries.id })
        .from(alertDeliveries)
        .where(and(eq(alertDeliveries.channel, "whatsapp"), eq(alertDeliveries.status, "sent")));
      for (let index = sentToday.length; index < 20; index++) {
        const alertId = await raiseAdminAlert(db.db, {
          kind: "payment.review_needed",
          severity: "info",
          refType: "payment",
          refId: randomUUID(),
          summary: `Filler alert ${index}.`,
          link: "/admin/billing/payments",
        });
        await db.db.insert(alertDeliveries).values({
          alertId,
          adminUserId: adminId,
          channel: "whatsapp",
          status: "sent",
          sentAt: new Date(),
        });
      }
      const capped = await deliver(await whatsappDelivery("Order WSO-2026-000904."));
      expect(capped).toMatchObject({ status: "skipped", error: "cap_reached" });
      expect(await redis.llen("wa:alerts")).toBe(1);
    } finally {
      await setAlertsSetting(null);
      await redis.del("wa:alerts");
    }
  });
});

describe("protected account change, worker side", () => {
  it("applies a due change, audits it, and alerts every billing.write admin even when muted", async () => {
    const [method] = await db.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, methodKey));
    if (!method) throw new Error("method missing");
    const [change] = await db.db
      .insert(paymentMethodAccountChanges)
      .values({
        methodId: method.id,
        oldAccountDisplay: method.accountDisplay ?? "",
        newAccountDisplay: "01512345678",
        oldAccountHolder: null,
        newAccountHolder: "New Holder",
        requestedBy: adminId,
        reason: "Settlement account moved",
        effectiveAt: new Date(Date.now() + 5 * 60_000),
      })
      .returning();
    if (!change) throw new Error("change insert failed");

    // Inside the cooldown nothing changes.
    await applyDuePaymentMethodChangesJob({}, { db: db.db, logger });
    const [before] = await db.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, method.id));
    expect(before?.accountDisplay).toBe(method.accountDisplay);

    await db.db
      .update(paymentMethodAccountChanges)
      .set({ effectiveAt: new Date(Date.now() - 1_000) })
      .where(eq(paymentMethodAccountChanges.id, change.id));
    await applyDuePaymentMethodChangesJob({}, { db: db.db, logger });
    const [after] = await db.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.id, method.id));
    expect(after).toMatchObject({ accountDisplay: "01512345678", accountHolder: "New Holder" });
    const [applied] = await db.db
      .select()
      .from(paymentMethodAccountChanges)
      .where(eq(paymentMethodAccountChanges.id, change.id));
    expect(applied?.status).toBe("applied");
    const audits = await db.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, "payment_method.account_change_applied"),
          eq(auditLogs.targetId, methodKey),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0]?.after)).not.toContain("01512345678");

    const [alert] = await db.db
      .select()
      .from(adminAlerts)
      .where(
        and(
          eq(adminAlerts.kind, "payment_method.account_change_applied"),
          eq(adminAlerts.refId, change.id),
        ),
      );
    if (!alert) throw new Error("applied alert missing");
    expect(alert.severity).toBe("critical");

    await db.db
      .update(adminAlertPrefs)
      .set({ mutedKinds: ["payment_method.account_change_applied"] })
      .where(eq(adminAlertPrefs.userId, financeAdminId));
    const runtime = {
      webOrigin: "https://wasfa.example",
      enqueueEmail: async () => undefined,
      enqueueAlertDelivery: async () => undefined,
      enqueueAlertDigest: async () => undefined,
    };
    const fanOut = outboxHandlers(runtime)["alerts.fan_out"];
    if (!fanOut) throw new Error("fan-out handler missing");
    const [entry] = await db.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `alert:${alert.id}`));
    if (!entry) throw new Error("alert outbox row missing");
    await db.db.transaction((tx) => fanOut(tx, entry));
    const recipients = await db.db
      .select({ adminUserId: alertDeliveries.adminUserId, channel: alertDeliveries.channel })
      .from(alertDeliveries)
      .where(eq(alertDeliveries.alertId, alert.id));
    expect(recipients).toContainEqual({ adminUserId: financeAdminId, channel: "in_app" });
    expect(
      recipients.filter((row) => row.adminUserId === adminId).map((row) => row.channel),
    ).toEqual(expect.arrayContaining(["in_app", "telegram"]));
  });
});

describe("no personal data in alerts", () => {
  it("no stored alert carries a phone number, a transaction id or a file URL", async () => {
    const { txnId } = await paymentUnderReview("pii");
    const rows = await db.db.select({ summary: adminAlerts.summary }).from(adminAlerts);
    expect(rows.length).toBeGreaterThan(0);
    for (const { summary } of rows) {
      expect(isSafeAlertSummary(summary), summary).toBe(true);
      expect(summary).not.toContain(txnId);
      expect(summary).not.toMatch(/TXN-/);
    }
    const reviewRows = await db.db
      .select({ summary: adminAlerts.summary })
      .from(adminAlerts)
      .where(inArray(adminAlerts.kind, ["payment.review_needed"]));
    expect(reviewRows.some(({ summary }) => summary.includes("012*****678"))).toBe(true);
  });
});
