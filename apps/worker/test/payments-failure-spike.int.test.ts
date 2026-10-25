import {
  NO_SUBSCRIPTION_HOOKS,
  adminAlerts,
  createDb,
  createOrder,
  creditPacks,
  paymentEvents,
  payments,
  seedDefaults,
  siteSettings,
  users,
} from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { paymentsFailureSpikeJob } from "../src/jobs/payments-failure-spike.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

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

async function addPayment(status: "failed" | "succeeded", at: Date, gateway: boolean) {
  const [user] = await owner.db
    .insert(users)
    .values({
      name: "Buyer",
      email: `failure-spike-${String(++counter)}@example.com`,
      locale: "en",
    })
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
      quoteHash: "c".repeat(64),
      subtotalMinor: 7_900,
      discountMinor: 0,
      taxMinor: 0,
      feeMinor: 0,
      totalMinor: 7_900,
      applied: {},
      expiresAt: new Date(at.getTime() + 3_600_000),
      method: {
        key: gateway ? "kashier_card" : "instapay",
        gateway: gateway ? "kashier" : null,
      },
    },
    NO_SUBSCRIPTION_HOOKS,
  );
  if (!created.payment) throw new Error("expected a payment");

  await owner.db
    .update(payments)
    .set({ status, updatedAt: at })
    .where(eq(payments.id, created.payment.id));
  await owner.db.insert(paymentEvents).values({
    provider: "internal",
    eventId: `failure-spike:${created.payment.id}`,
    type: "transition",
    paymentId: created.payment.id,
    payload: { from: "processing", to: status },
    signatureOk: true,
    receivedAt: at,
  });
}

async function failureSpikeAlerts() {
  return owner.db.select().from(adminAlerts).where(eq(adminAlerts.kind, "payment.failure_spike"));
}

async function setFailureSpikeEnabled(enabled: boolean) {
  await owner.db
    .insert(siteSettings)
    .values({ key: "billing", value: { failureSpike: { enabled } } })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value: { failureSpike: { enabled } } },
    });
}

describe("payments.failure_spike", () => {
  it("alerts on gateway spikes, observes cooldown, ignores manual methods, and honors disablement", async () => {
    const now = new Date("2026-10-17T12:00:00.000Z");
    const recent = new Date(now.getTime() - 60_000);
    const logger = { info: () => undefined } as never;

    for (let index = 0; index < 4; index += 1) await addPayment("failed", recent, true);
    await paymentsFailureSpikeJob({}, { db: api.db, logger }, now);
    expect(await failureSpikeAlerts()).toHaveLength(0);

    for (let index = 0; index < 3; index += 1) await addPayment("failed", recent, true);
    for (let index = 0; index < 2; index += 1) await addPayment("succeeded", recent, true);
    await addPayment("failed", recent, false);
    await paymentsFailureSpikeJob({}, { db: api.db, logger }, now);
    const first = await failureSpikeAlerts();
    expect(first).toHaveLength(1);
    expect(first[0]?.summary).toBe(
      "Card payments (kashier_card): 7 of 9 failed in the last 15 min",
    );
    expect(first[0]?.link).toBe("/admin/billing/payments?status=failed&method=kashier_card");
    expect(first[0]?.summary).not.toMatch(/@|\+?\d{7,}/);

    await paymentsFailureSpikeJob({}, { db: api.db, logger }, new Date(now.getTime() + 5 * 60_000));
    expect(await failureSpikeAlerts()).toHaveLength(1);

    const afterCooldown = new Date(now.getTime() + 61 * 60_000);
    for (let index = 0; index < 5; index += 1) {
      await addPayment("failed", new Date(afterCooldown.getTime() - 60_000), true);
    }
    await paymentsFailureSpikeJob({}, { db: api.db, logger }, afterCooldown);
    expect(await failureSpikeAlerts()).toHaveLength(2);

    await setFailureSpikeEnabled(false);
    for (let index = 0; index < 5; index += 1) {
      await addPayment("failed", new Date(afterCooldown.getTime() + 60_000), true);
    }
    await paymentsFailureSpikeJob(
      {},
      { db: api.db, logger },
      new Date(afterCooldown.getTime() + 2 * 60_000),
    );
    expect(await failureSpikeAlerts()).toHaveLength(2);
  });
});
