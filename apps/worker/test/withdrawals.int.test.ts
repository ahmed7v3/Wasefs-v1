import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  addPayoutDestination,
  adminAlerts,
  alertDeliveries,
  approveWithdrawal,
  createDb,
  markWithdrawalPaid,
  outbox,
  payoutMethods,
  pointsMove,
  rejectWithdrawal,
  requestWithdrawal,
  runMigrations,
  seedDefaults,
  siteSettings,
  userRoles,
  users,
  withdrawalRequests,
  type OutboxPostCommitAction,
} from "@wasfa/db";
import { and, eq, inArray } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { outboxHandlers } from "../src/jobs/outbox.job.js";
import { isWithinBusinessHours } from "../src/jobs/payments-review-sla.job.js";
import { withdrawalsOverdueJob, withdrawalsReconcileJob } from "../src/jobs/withdrawals.job.js";
import { HANDLERS } from "../src/queues.js";

/*
 * Withdrawals on the worker (Task 3.12): the alert reaches every admin who may review, customer
 * notices carry the right template and reason, overdue reminders fire once per slot inside business
 * hours, and the nightly reconciliation is quiet unless the ledger and the requests disagree.
 */

let postgres: StartedPostgreSqlContainer;
let db: ReturnType<typeof createDb>;
let methodId: string;
const logger = pino({ level: "silent" });
const DAY = 86_400_000;
const NOW = new Date();
const runtime = {
  webOrigin: "https://wasfa.example",
  enqueueEmail: async () => undefined,
  enqueueAlertDelivery: async () => undefined,
  enqueueAlertDigest: async () => undefined,
};

beforeAll(async () => {
  postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  db = createDb({ url: postgres.getConnectionUri(), max: 3 });
  await runMigrations(db.db);
  await seedDefaults(db.db);
  const value = { enabled: true, cashOutEnabled: true, destinationCooldownHours: 0 };
  await db.db
    .insert(siteSettings)
    .values({ key: "rewards", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
  const [method] = await db.db
    .insert(payoutMethods)
    .values({
      key: "test_wallet",
      nameAr: "محفظة",
      nameEn: "Wallet",
      enabled: true,
      fieldSchema: {
        fields: [{ key: "number", labelKey: "k", kind: "egypt_mobile", required: true }],
      },
    })
    .returning({ id: payoutMethods.id });
  if (!method) throw new Error("method insert failed");
  methodId = method.id;
}, 180_000);

afterAll(async () => {
  await db?.close();
  await postgres?.stop();
});

async function newUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db.db
    .insert(users)
    .values({
      name: "Mona Ahmed",
      email: `${randomUUID()}@example.com`,
      phone: `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      phoneVerified: true,
      phoneVerifiedAt: NOW,
      createdAt: new Date(NOW.getTime() - 30 * DAY),
      locale: "en",
      ...values,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

/** A user with 3,000 cash points and a usable destination, who has asked to withdraw 1,000. */
async function requested() {
  const userId = await newUser();
  await db.db.transaction((tx) =>
    pointsMove(tx, {
      userId,
      kind: "admin_adjust",
      rows: [{ bucket: "cash", amount: 3_000, idempotencyKey: `t:${randomUUID()}` }],
      referenceType: "admin",
      referenceId: randomUUID(),
      lifetimeDelta: 3_000,
    }),
  );
  const { destination } = await addPayoutDestination(db.db, {
    id: randomUUID(),
    userId,
    methodId,
    valueEnc: "sealed",
    masked: "010••••7026",
    destinationHash: randomUUID().replaceAll("-", "").repeat(2),
    now: NOW,
  });
  const { request } = await requestWithdrawal(db.db, {
    userId,
    destinationId: destination.id,
    points: 1_000,
    requestId: randomUUID(),
    now: NOW,
  });
  return { userId, request };
}

describe("the withdrawal.requested alert", () => {
  it("reaches every admin who may review, and nobody else", async () => {
    const first = await newUser();
    const second = await newUser();
    const outsider = await newUser();
    await db.db.insert(userRoles).values([
      { userId: first, roleKey: "super_admin" },
      { userId: second, roleKey: "super_admin" },
      { userId: outsider, roleKey: "support" },
    ]);
    const { request } = await requested();
    const [alert] = await db.db.select().from(adminAlerts).where(eq(adminAlerts.refId, request.id));
    expect(alert).toMatchObject({
      kind: "withdrawal.requested",
      refType: "withdrawal",
      link: `/admin/growth/withdrawals?id=${request.id}`,
    });
    expect(alert?.summary).toContain("1,000 points");
    expect(alert?.summary).toContain("first_withdrawal");

    const [entry] = await db.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `alert:${alert?.id ?? ""}`));
    if (!entry) throw new Error("fan-out entry missing");
    const fanOut = outboxHandlers(runtime)["alerts.fan_out"];
    if (!fanOut) throw new Error("fan-out handler missing");
    await db.db.transaction((tx) => fanOut(tx, entry));
    const deliveries = await db.db
      .select()
      .from(alertDeliveries)
      .where(and(eq(alertDeliveries.alertId, entry.payload.alertId as string)));
    const inApp = deliveries
      .filter((row) => row.channel === "in_app")
      .map((row) => row.adminUserId);
    expect(inApp).toEqual(expect.arrayContaining([first, second]));
    expect(inApp).not.toContain(outsider);
    // Email and Telegram follow for each of them; WhatsApp stays off.
    expect(deliveries.some((row) => row.channel === "whatsapp")).toBe(false);
    expect(deliveries.filter((row) => row.channel === "email").length).toBeGreaterThanOrEqual(2);
  });
});

describe("withdrawals.notify", () => {
  async function notices(requestId: string): Promise<OutboxPostCommitAction[]> {
    const handler = outboxHandlers(runtime)["withdrawals.notify"];
    if (!handler) throw new Error("withdrawals.notify handler missing");
    const entries = await db.db.select().from(outbox).where(eq(outbox.topic, "withdrawals.notify"));
    const mine = entries.filter(
      (entry) => (entry.payload as { requestId?: string }).requestId === requestId,
    );
    const actions: OutboxPostCommitAction[] = [];
    for (const entry of mine) {
      const result = await db.db.transaction((tx) => handler(tx, entry));
      if (Array.isArray(result)) actions.push(...(result as OutboxPostCommitAction[]));
    }
    return actions;
  }

  it("sends the request notice, then the rejection with its reason, by template", async () => {
    const admin = await newUser();
    const { request } = await requested();
    await approveWithdrawal(db.db, { id: request.id, adminId: admin, now: NOW });
    await rejectWithdrawal(db.db, {
      id: request.id,
      adminId: admin,
      reasonKey: "account_review",
      note: "call us",
    });
    const actions = await notices(request.id);
    const kinds = actions.flatMap((action) =>
      action.kind === "customer_message" ? [action.payload.kind] : [],
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        "withdrawal_requested",
        "withdrawal_approved",
        "withdrawal_rejected",
      ]),
    );
    const rejected = actions.find(
      (action) =>
        action.kind === "customer_message" && action.payload.kind === "withdrawal_rejected",
    );
    if (rejected?.kind !== "customer_message") throw new Error("rejection notice missing");
    expect(rejected.payload.params).toMatchObject({
      reason: "Your account is under review",
      note: "call us",
    });
    expect(rejected.payload.email).toMatchObject({
      template: "withdrawal_update",
      event: "rejected",
      reason: "account_review",
    });
    // The destination never appears, not even masked.
    expect(JSON.stringify(actions)).not.toContain("7026");
  });

  it("the paid notice carries the transfer reference", async () => {
    const admin = await newUser();
    const payer = await newUser();
    const { request } = await requested();
    await approveWithdrawal(db.db, { id: request.id, adminId: admin, now: NOW });
    await markWithdrawalPaid(db.db, {
      id: request.id,
      adminId: payer,
      transferReference: `REF-${randomUUID().slice(0, 8)}`,
      now: NOW,
    });
    const paid = (await notices(request.id)).find(
      (action) => action.kind === "customer_message" && action.payload.kind === "withdrawal_paid",
    );
    if (paid?.kind !== "customer_message") throw new Error("paid notice missing");
    expect(String(paid.payload.params?.reference)).toMatch(/^REF-/);
  });
});

describe("withdrawals.overdue", () => {
  /** A moment inside the default business hours, found by stepping hour by hour. */
  function businessMoment(): Date {
    let at = new Date("2026-11-02T06:00:00Z");
    for (let i = 0; i < 24 * 7; i++) {
      if (
        isWithinBusinessHours(at, {
          timezone: "Africa/Cairo",
          startHour: 9,
          endHour: 22,
          days: [0, 1, 2, 3, 4],
        })
      ) {
        return at;
      }
      at = new Date(at.getTime() + 3_600_000);
    }
    throw new Error("no business moment");
  }

  it("raises one alert per request and slot, only when older than the SLA and not paid", async () => {
    const old = await requested();
    const fresh = await requested();
    const now = businessMoment();
    await db.db
      .update(withdrawalRequests)
      .set({ createdAt: new Date(now.getTime() - 3 * DAY) })
      .where(eq(withdrawalRequests.id, old.request.id));
    await db.db
      .update(withdrawalRequests)
      .set({ createdAt: new Date(now.getTime() - 3_600_000) })
      .where(eq(withdrawalRequests.id, fresh.request.id));
    const count = async (id: string) =>
      (
        await db.db
          .select()
          .from(adminAlerts)
          .where(and(eq(adminAlerts.kind, "withdrawal.overdue"), eq(adminAlerts.refId, id)))
      ).length;

    await withdrawalsOverdueJob({}, { db: db.db }, now);
    await withdrawalsOverdueJob({}, { db: db.db }, new Date(now.getTime() + 60_000));
    expect(await count(old.request.id)).toBe(1);
    expect(await count(fresh.request.id)).toBe(0);
    await withdrawalsOverdueJob({}, { db: db.db }, new Date(now.getTime() + 31 * 60_000));
    expect(await count(old.request.id)).toBe(2);

    // Outside business hours nothing is raised.
    const night = new Date(now.getTime() + 12 * 3_600_000 + 2 * 60_000);
    if (
      !isWithinBusinessHours(night, {
        timezone: "Africa/Cairo",
        startHour: 9,
        endHour: 22,
        days: [0, 1, 2, 3, 4],
      })
    ) {
      await withdrawalsOverdueJob({}, { db: db.db }, night);
      expect(await count(old.request.id)).toBe(2);
    }

    // Paid requests are not overdue any more.
    const admin = await newUser();
    const payer = await newUser();
    await approveWithdrawal(db.db, { id: old.request.id, adminId: admin, now });
    await markWithdrawalPaid(db.db, {
      id: old.request.id,
      adminId: payer,
      transferReference: `REF-${randomUUID().slice(0, 8)}`,
      now,
    });
    await withdrawalsOverdueJob({}, { db: db.db }, new Date(now.getTime() + 61 * 60_000));
    expect(await count(old.request.id)).toBe(2);
  });
});

describe("withdrawals.reconcile", () => {
  it("is quiet when the ledger adds up and raises one critical alert on drift", async () => {
    const kind = "points.reconcile_drift";
    const drift = async () =>
      (
        await db.db
          .select()
          .from(adminAlerts)
          .where(inArray(adminAlerts.kind, [kind]))
      ).filter((alert) => alert.refType === "withdrawals_reconcile");
    await withdrawalsReconcileJob({}, { db: db.db, logger });
    expect(await drift()).toHaveLength(0);

    const { request } = await requested();
    await db.db
      .update(withdrawalRequests)
      .set({ status: "canceled" })
      .where(eq(withdrawalRequests.id, request.id));
    await withdrawalsReconcileJob({}, { db: db.db, logger });
    const alerts = await drift();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "critical" });
    expect(HANDLERS.payments["withdrawals.reconcile"]).toBe(withdrawalsReconcileJob);
    expect(HANDLERS.payments["withdrawals.overdue"]).toBe(withdrawalsOverdueJob);
  });
});
