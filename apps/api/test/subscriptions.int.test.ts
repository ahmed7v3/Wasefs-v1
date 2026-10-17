import { randomUUID } from "node:crypto";

import {
  onboardingProgress,
  orders,
  paymentMethods,
  plans,
  subscriptionEvents,
  subscriptions,
  users,
} from "@wasfa/db";
import { type FakeWebhookBody } from "@wasfa/shared/gateways";
import { createOrderResponseSchema, quoteResponseSchema } from "@wasfa/shared/schemas/billing";
import {
  myOrdersResponseSchema,
  mySubscriptionResponseSchema,
} from "@wasfa/shared/schemas/subscriptions";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GatewayRegistry } from "../src/payments/gateway-registry.js";

import { AdminTestContext, type Person } from "./support/admin-context.js";

/*
 * The customer's subscription over HTTP (Task 3.5): a card payment through the fake gateway turns
 * into a period (once, however many webhooks arrive), then view, cancel/resume, the renew quote,
 * the order history and receipts, and trials. Owner scoping, 401s, invalid input and rate limits.
 */

const ctx = new AdminTestContext();
let registry: GatewayRegistry;

beforeAll(async () => {
  await ctx.start();
  registry = ctx.app.get(GatewayRegistry);
  const { db } = ctx.owner;
  await db
    .update(plans)
    .set({ visibility: "public" })
    .where(inArray(plans.key, ["plus", "pro"]));
  await db.update(plans).set({ monthlyCredits: 150, trialDays: 7 }).where(eq(plans.key, "plus"));
  await db.insert(paymentMethods).values({
    key: "fake_card",
    kind: "gateway",
    provider: "fake",
    nameAr: "بطاقة تجريبية",
    nameEn: "Test card",
    currencies: ["EGP"],
    enabled: true,
  });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

type Who = Pick<Person, "jar" | "userId">;

async function customer(): Promise<Person> {
  const person = await ctx.harness.signedInUser();
  await ctx.owner.db
    .insert(onboardingProgress)
    .values({ userId: person.userId, currentStep: "done", completedAt: new Date() })
    .onConflictDoNothing();
  return person;
}

function webhook(body: FakeWebhookBody) {
  const fake = registry.fake;
  if (!fake) throw new Error("fake gateway missing");
  return ctx.harness.call("POST", "/webhooks/fake", {
    body: body as unknown as Record<string, unknown>,
    origin: null,
    headers: { "x-fake-signature": fake.sign(body) },
  });
}

/** Buys `months` of plus with the card and confirms it with `deliveries` identical webhooks. */
async function buyPlus(who: Who, months = 1, deliveries = 1) {
  const quoted = await ctx.harness.call("POST", "/billing/quote", {
    jar: who.jar,
    body: { planKey: "plus", months, methodKey: "fake_card" },
  });
  expect(quoted.statusCode, quoted.body).toBe(200);
  const q = quoteResponseSchema.parse(quoted.json());
  const created = await ctx.harness.call("POST", "/billing/orders", {
    jar: who.jar,
    body: { quoteId: q.quoteId, methodKey: "fake_card" },
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = createOrderResponseSchema.parse(created.json());
  const paymentId = order.payment?.id;
  if (!paymentId) throw new Error("payment missing");
  const body: FakeWebhookBody = {
    eventId: randomUUID(),
    paymentId,
    providerRef: `fake_${paymentId}`,
    state: "succeeded",
    amountMinor: q.quote.totalMinor,
    currency: "EGP",
  };
  const answers = await Promise.all(Array.from({ length: deliveries }, () => webhook(body)));
  for (const answer of answers) expect(answer.statusCode).toBe(200);
  return order.orderId;
}

const routes: Array<["GET" | "POST", string, Record<string, unknown>?]> = [
  ["GET", "/me/subscription"],
  ["POST", "/me/subscription/cancel"],
  ["POST", "/me/subscription/resume"],
  ["POST", "/me/subscription/renew-quote", {}],
  ["POST", "/me/trial", { planKey: "plus" }],
  ["GET", "/me/orders"],
  ["GET", `/me/orders/${randomUUID()}/receipt`],
];

describe("/me subscription routes", () => {
  it("need a session", async () => {
    for (const [method, path, body] of routes) {
      const res = await ctx.harness.call(method, path, body ? { body } : {});
      expect(res.statusCode, path).toBe(401);
    }
  });

  it("ten duplicate webhooks give one period; the subscription reads back with its next grant", async () => {
    const buyer = await customer();
    const before = await ctx.harness.call("GET", "/me/subscription", { jar: buyer.jar });
    expect(mySubscriptionResponseSchema.parse(before.json()).subscription).toBeNull();

    const orderId = await buyPlus(buyer, 1, 10);
    const rows = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, buyer.userId));
    expect(rows).toHaveLength(1);
    const events = await ctx.owner.db
      .select()
      .from(subscriptionEvents)
      .where(sql`${subscriptionEvents.data}->>'orderId' = ${orderId}`);
    expect(events).toHaveLength(1);

    const res = await ctx.harness.call("GET", "/me/subscription", { jar: buyer.jar });
    expect(res.statusCode, res.body).toBe(200);
    const body = mySubscriptionResponseSchema.parse(res.json());
    expect(body.subscription).toMatchObject({
      plan: { key: "plus" },
      status: "active",
      source: "paid",
      monthsPaid: 1,
      cancelAtPeriodEnd: false,
      pendingChange: null,
    });
    // One-month period: the only anniversary is the start, so no further grant is due.
    expect(body.subscription?.nextCreditGrantAt).toBeNull();
  });

  it("cancels at the period end and resumes", async () => {
    const buyer = await customer();
    await buyPlus(buyer, 12);
    const canceled = await ctx.harness.call("POST", "/me/subscription/cancel", { jar: buyer.jar });
    expect(canceled.statusCode, canceled.body).toBe(200);
    expect(mySubscriptionResponseSchema.parse(canceled.json()).subscription).toMatchObject({
      cancelAtPeriodEnd: true,
      status: "active",
    });
    const resumed = await ctx.harness.call("POST", "/me/subscription/resume", { jar: buyer.jar });
    const view = mySubscriptionResponseSchema.parse(resumed.json()).subscription;
    expect(view?.cancelAtPeriodEnd).toBe(false);
    expect(view?.nextCreditGrantAt).not.toBeNull();

    const nobody = await customer();
    expect(
      (await ctx.harness.call("POST", "/me/subscription/cancel", { jar: nobody.jar })).statusCode,
    ).toBe(404);
  });

  it("prices the renewal of the same plan and refuses a client-chosen plan or bad input", async () => {
    const buyer = await customer();
    await buyPlus(buyer, 12);
    const res = await ctx.harness.call("POST", "/me/subscription/renew-quote", {
      jar: buyer.jar,
      body: { methodKey: "fake_card" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const q = quoteResponseSchema.parse(res.json());
    expect(q.quote).toMatchObject({ planKey: "plus", months: 12 });

    const smuggled = await ctx.harness.call("POST", "/me/subscription/renew-quote", {
      jar: buyer.jar,
      body: { planKey: "pro", months: 1 },
    });
    expect(smuggled.statusCode).toBe(200);
    expect(quoteResponseSchema.parse(smuggled.json()).quote.planKey).toBe("plus");

    const bad = await ctx.harness.call("POST", "/me/subscription/renew-quote", {
      jar: buyer.jar,
      body: { months: 0 },
    });
    expect(bad.statusCode).toBe(400);
    const none = await customer();
    expect(
      (
        await ctx.harness.call("POST", "/me/subscription/renew-quote", {
          jar: none.jar,
          body: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it("lists the caller's orders and serves receipts only for their paid orders", async () => {
    const buyer = await customer();
    const orderId = await buyPlus(buyer, 1);
    const list = await ctx.harness.call("GET", "/me/orders?limit=10", { jar: buyer.jar });
    expect(list.statusCode, list.body).toBe(200);
    const page = myOrdersResponseSchema.parse(list.json());
    expect(page.items[0]).toMatchObject({
      id: orderId,
      kind: "subscription",
      planKey: "plus",
      status: "paid",
      receiptAvailable: true,
    });

    const receipt = await ctx.harness.call("GET", `/me/orders/${orderId}/receipt`, {
      jar: buyer.jar,
    });
    expect(receipt.statusCode, receipt.body).toBe(200);
    const body = receipt.json<{
      number: string;
      lines: Array<{ kind: string }>;
      totals: { totalMinor: number };
      payment: { methodKey: string } | null;
      buyer: { email: string | null };
    }>();
    expect(body.lines.map((line) => line.kind)).toContain("plan");
    expect(body.payment?.methodKey).toBe("fake_card");
    expect(body.buyer.email).toMatch(/^.\*\*\*@/);

    const stranger = await customer();
    expect(
      (await ctx.harness.call("GET", `/me/orders/${orderId}/receipt`, { jar: stranger.jar }))
        .statusCode,
    ).toBe(404);
    const strangerList = myOrdersResponseSchema.parse(
      (await ctx.harness.call("GET", "/me/orders", { jar: stranger.jar })).json(),
    );
    expect(strangerList.items.map((item) => item.id)).not.toContain(orderId);

    // An unpaid order has no receipt.
    const quoted = await ctx.harness.call("POST", "/billing/quote", {
      jar: stranger.jar,
      body: { planKey: "plus", months: 1, methodKey: "fake_card" },
    });
    const q = quoteResponseSchema.parse(quoted.json());
    const unpaid = createOrderResponseSchema.parse(
      (
        await ctx.harness.call("POST", "/billing/orders", {
          jar: stranger.jar,
          body: { quoteId: q.quoteId, methodKey: "fake_card" },
        })
      ).json(),
    );
    expect(
      (
        await ctx.harness.call("GET", `/me/orders/${unpaid.orderId}/receipt`, {
          jar: stranger.jar,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await ctx.harness.call("GET", "/me/orders?cursor=not-a-cursor", { jar: buyer.jar }))
        .statusCode,
    ).toBe(400);
    const [row] = await ctx.owner.db.select().from(orders).where(eq(orders.id, orderId));
    expect(body.totals.totalMinor).toBe(row?.totalMinor);
  });
});

describe("POST /me/trial", () => {
  async function withPhone(person: Person, phone: string) {
    await ctx.owner.db
      .update(users)
      .set({ phone, phoneVerified: true, phoneVerifiedAt: new Date() })
      .where(eq(users.id, person.userId));
  }

  it("starts once, needs a verified phone, and validates the plan key", async () => {
    const noPhone = await customer();
    const refused = await ctx.harness.call("POST", "/me/trial", {
      jar: noPhone.jar,
      body: { planKey: "plus" },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });

    const person = await customer();
    await withPhone(person, "+201066601234");
    const view = await ctx.harness.call("GET", "/me/subscription", { jar: person.jar });
    expect(mySubscriptionResponseSchema.parse(view.json()).trialAvailable).toBe(true);
    const started = await ctx.harness.call("POST", "/me/trial", {
      jar: person.jar,
      body: { planKey: "plus" },
    });
    expect(started.statusCode, started.body).toBe(200);
    const body = mySubscriptionResponseSchema.parse(started.json());
    expect(body.subscription).toMatchObject({ status: "trialing", source: "trial" });
    expect(body.trialAvailable).toBe(false);

    const again = await ctx.harness.call("POST", "/me/trial", {
      jar: person.jar,
      body: { planKey: "plus" },
    });
    expect(again.statusCode).toBe(409);

    const hidden = await customer();
    await withPhone(hidden, "+201066605678");
    const noTrialPlan = await ctx.harness.call("POST", "/me/trial", {
      jar: hidden.jar,
      body: { planKey: "pro" },
    });
    expect(noTrialPlan.statusCode).toBe(409);
    expect(noTrialPlan.json()).toMatchObject({ code: "TRIAL_UNAVAILABLE" });
    const invalid = await ctx.harness.call("POST", "/me/trial", {
      jar: hidden.jar,
      body: { planKey: "NOT A KEY" },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("is rate-limited per account", async () => {
    const person = await customer();
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await ctx.harness.call("POST", "/me/trial", {
        jar: person.jar,
        body: { planKey: "plus" },
      });
      expect(res.statusCode).not.toBe(429);
    }
    const limited = await ctx.harness.call("POST", "/me/trial", {
      jar: person.jar,
      body: { planKey: "plus" },
    });
    expect(limited.statusCode).toBe(429);
  });
});
