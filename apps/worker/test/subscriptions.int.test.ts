import {
  activatePayment,
  attachCheckout,
  createDb,
  createOrder,
  creditLedger,
  creditWallets,
  drainOutbox,
  outbox,
  plans,
  seedDefaults,
  subscriptions,
  SUBSCRIPTION_HOOKS,
  userNotifications,
  users,
} from "@wasfa/db";
import { addDays } from "@wasfa/shared/subscriptions";
import { and, eq, like } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantMonthlyJob } from "../src/jobs/credits.grant.job.js";
import { outboxHandlers } from "../src/jobs/outbox.job.js";
import { subscriptionsLifecycleJob } from "../src/jobs/subscriptions.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

import type { EmailSendInput } from "@wasfa/shared/email";

/*
 * The subscription jobs as the worker runs them in production: as the restricted `wasfa_api`
 * role. The lifecycle walks live subscriptions to `now`, its reminders go out through the outbox
 * (in-app + the renew mail), and the Phase 2 calendar grant leaves subscribed owners alone.
 */

const logger = pino({ level: "silent" });
let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;
let plusId: string;
let counter = 0;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  await seedDefaults(owner.db);
  const [plus] = await owner.db.select().from(plans).where(eq(plans.key, "plus"));
  if (!plus) throw new Error("plus not seeded");
  plusId = plus.id;
  await owner.db.update(plans).set({ monthlyCredits: 150 }).where(eq(plans.id, plusId));
}, 180_000);

afterAll(async () => {
  await Promise.all([owner?.close(), worker?.close()]);
  await postgres?.stop();
});

async function verifiedUser(): Promise<string> {
  const [row] = await owner.db
    .insert(users)
    .values({
      name: "Subscriber",
      email: `subscriber${String(++counter)}@example.com`,
      emailVerified: true,
      locale: "ar",
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

/** A paid month of plus at `now`, activated as the worker's reconciliation would (wasfa_api role). */
async function paidMonth(userId: string, now: Date) {
  const created = await createOrder(
    worker.db,
    {
      owner: { type: "user", id: userId },
      kind: "subscription",
      planId: plusId,
      packId: null,
      months: 1,
      currency: "EGP",
      quote: { grants: { bonusCredits: 0, extraMonths: 0 } },
      quoteHash: "a".repeat(64),
      subtotalMinor: 9_900,
      discountMinor: 0,
      taxMinor: 0,
      feeMinor: 0,
      totalMinor: 9_900,
      applied: {},
      expiresAt: addDays(now, 1),
      method: { key: "fake_card", gateway: "fake" },
    },
    SUBSCRIPTION_HOOKS,
  );
  if (!created.payment) throw new Error("payment missing");
  await attachCheckout(worker.db, created.payment.id, `fake_${created.payment.id}`);
  await activatePayment(
    worker.db,
    created.payment.id,
    { amountMinor: 9_900, currency: "EGP" },
    SUBSCRIPTION_HOOKS,
    now,
  );
  const [sub] = await owner.db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerUserId, userId));
  if (!sub) throw new Error("subscription missing");
  return sub;
}

async function grantsOf(userId: string) {
  const [wallet] = await owner.db
    .select()
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  if (!wallet) return [];
  return owner.db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.walletId, wallet.id), eq(creditLedger.kind, "grant")));
}

describe("subscriptions.lifecycle", () => {
  it("reminds through the outbox with the renew link, then moves the period to grace and expiry", async () => {
    const userId = await verifiedUser();
    const sub = await paidMonth(userId, new Date("2026-09-01T10:00:00.000Z"));
    const end = sub.currentPeriodEnd;

    await subscriptionsLifecycleJob({}, { db: worker.db, logger }, addDays(end, -6.5));
    const mails: Array<{ payload: EmailSendInput; jobId: string }> = [];
    const handlers = outboxHandlers({
      webOrigin: "https://wasfa.example",
      enqueueEmail: async (payload, jobId) => {
        mails.push({ payload, jobId });
      },
      enqueueAlertDelivery: async () => undefined,
      enqueueAlertDigest: async () => undefined,
    });
    await drainOutbox(worker.db, handlers, new Date());
    const reminders = mails.filter((mail) => mail.payload.template === "subscription_reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.payload).toMatchObject({
      template: "subscription_reminder",
      slot: "d7",
      link: `https://wasfa.example/billing/renew?sub=${sub.id}`,
      endsAt: end.toISOString(),
    });
    const notes = await owner.db
      .select()
      .from(userNotifications)
      .where(eq(userNotifications.userId, userId));
    expect(notes).toContainEqual(
      expect.objectContaining({
        kind: "billing.subscription_reminder",
        link: `/billing/renew?sub=${sub.id}`,
      }),
    );

    // A second run in the same slot queues nothing new.
    await subscriptionsLifecycleJob({}, { db: worker.db, logger }, addDays(end, -6.4));
    const queued = await owner.db
      .select()
      .from(outbox)
      .where(like(outbox.idempotencyKey, `sub_reminder:${sub.id}:%`));
    expect(queued).toHaveLength(1);

    await subscriptionsLifecycleJob({}, { db: worker.db, logger }, addDays(end, 0.01));
    expect(
      (await owner.db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0]?.status,
    ).toBe("grace");
    await subscriptionsLifecycleJob({}, { db: worker.db, logger }, addDays(end, 3));
    expect(
      (await owner.db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0]?.status,
    ).toBe("expired");
  });
});

describe("credits.grant_monthly with subscriptions", () => {
  it("skips an owner with a live subscription and pays them again once it has ended", async () => {
    const userId = await verifiedUser();
    const now = new Date();
    const sub = await paidMonth(userId, now);
    expect(await grantsOf(userId)).toHaveLength(1); // the subscription's own month-0 grant

    await grantMonthlyJob({}, { db: worker.db, logger }, now);
    const afterCalendar = await grantsOf(userId);
    expect(afterCalendar).toHaveLength(1);
    expect(afterCalendar[0]?.idempotencyKey).toContain(`:${sub.id}:p`);

    await owner.db
      .update(subscriptions)
      .set({ status: "expired" })
      .where(eq(subscriptions.id, sub.id));
    await grantMonthlyJob({}, { db: worker.db, logger }, now);
    const keys = (await grantsOf(userId)).map((row) => row.idempotencyKey);
    expect(keys).toContain(`grant:user:${userId}:${now.toISOString().slice(0, 7)}`);
  });
});
