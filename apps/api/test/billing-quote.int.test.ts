import { randomUUID } from "node:crypto";

import {
  couponRedemptions,
  coupons,
  orders,
  paymentMethods,
  personalOffers,
  plans,
  promotions,
  subscriptions,
} from "@wasfa/db";
import { quote as engineQuote } from "@wasfa/shared/price-engine";
import { quoteResponseSchema, recommendationResponseSchema } from "@wasfa/shared/schemas/billing";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QuoteService } from "../src/billing/quote.service.js";
import { CreditsService } from "../src/credits/credits.service.js";

import { AdminTestContext, type Person } from "./support/admin-context.js";
import { expectRateLimited } from "./support/identity-fixtures.js";

/*
 * POST /billing/quote and GET /me/recommendation against a real Postgres 18 and Redis. Seeds are
 * hidden, so setup publishes plus and pro (their EGP prices are seeded). Each test that creates
 * a discount ends it again, so tests do not see each other's promotions.
 */

const ctx = new AdminTestContext();
let quotes: QuoteService;
let planIds: Record<string, string>;
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  quotes = ctx.app.get(QuoteService);
  const { db } = ctx.owner;
  await db
    .update(plans)
    .set({ visibility: "public" })
    .where(inArray(plans.key, ["plus", "pro"]));
  const rows = await db.select({ id: plans.id, key: plans.key }).from(plans);
  planIds = Object.fromEntries(rows.map((row) => [row.key, row.id]));
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const DAY = 86_400_000;
const PLUS_MONTH = 9_900;

function planId(key: string): string {
  const id = planIds[key];
  if (!id) throw new Error(`plan ${key} is not seeded`);
  return id;
}

async function quoteAs(
  who: Pick<Person, "jar">,
  body: Record<string, unknown>,
  url = "/billing/quote",
) {
  return ctx.harness.call("POST", url, { jar: who.jar, body });
}

async function okQuote(who: Pick<Person, "jar">, body: Record<string, unknown>) {
  const res = await quoteAs(who, body);
  expect(res.statusCode, res.body).toBe(200);
  return quoteResponseSchema.parse(res.json());
}

const code = () => `T${String(++counter)}-${randomUUID().slice(0, 6).toUpperCase()}`;

async function newCoupon(extra: Partial<typeof coupons.$inferInsert> = {}) {
  const value = code();
  const [row] = await ctx.owner.db
    .insert(coupons)
    .values({
      code: value,
      kind: "percent",
      name: "Test coupon",
      titleAr: "كوبون",
      titleEn: "Coupon",
      value: 1_000,
      status: "active",
      ...extra,
    })
    .returning({ id: coupons.id });
  if (!row) throw new Error("coupon insert failed");
  return { id: row.id, code: value };
}

async function newPromotion(extra: Partial<typeof promotions.$inferInsert> = {}) {
  const [row] = await ctx.owner.db
    .insert(promotions)
    .values({
      kind: "percent",
      name: "Test promo",
      titleAr: "عرض",
      titleEn: "Promo",
      value: 3_000,
      status: "active",
      ...extra,
    })
    .returning({ id: promotions.id });
  if (!row) throw new Error("promotion insert failed");
  return row.id;
}

const endPromotion = (id: string) =>
  ctx.owner.db.update(promotions).set({ status: "ended" }).where(eq(promotions.id, id));

describe("authentication and input", () => {
  it("answers 401 without a session", async () => {
    const res = await ctx.harness.call("POST", "/billing/quote", {
      body: { planKey: "plus", months: 1 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("refuses a malformed request, and ignores a price sent by the client", async () => {
    const user = await ctx.harness.signedInUser();
    const bad = await quoteAs(user, { planKey: "plus", months: 0 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    const cheeky = await okQuote(user, {
      planKey: "plus",
      months: 1,
      amountMinor: 1,
      totalMinor: 1,
    });
    expect(cheeky.quote.totalMinor).toBe(PLUS_MONTH);
  });
});

describe("happy path and storage", () => {
  it("returns the engine's totals for the same inputs and stores a signed quote", async () => {
    const user = await ctx.harness.signedInUser();
    const res = await okQuote(user, { planKey: "plus", months: 1 });
    expect(res.coupon).toBeNull();

    const now = new Date(Date.parse(res.quote.expiresAt) - 15 * 60_000);
    const expected = engineQuote({
      price: { planKey: "plus", months: 1, currency: "EGP", amountMinor: PLUS_MONTH },
      discounts: [],
      methods: [
        { key: "instapay", feeBps: 0, feeFixedMinor: 0, currencies: ["EGP"] },
        { key: "vodafone_cash", feeBps: 0, feeFixedMinor: 0, currencies: ["EGP"] },
      ],
      history: { isFirstPurchase: true },
      settings: {
        maxTotalDiscountBps: 7_000,
        minChargeMinor: 1_000,
        minChargeMode: "raise",
        allowFreeOrders: true,
        quoteTtlMinutes: 15,
        creditValueMinor: 47,
      },
      now,
      country: null,
    });
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(res.quote).toEqual(expected.quote);
    expect(res.quote.totalMinor).toBe(PLUS_MONTH);
    expect(res.quote.methodKey).toBeNull();
    expect(res.quote.methodOptions.map((option) => option.key)).toEqual([
      "instapay",
      "vodafone_cash",
    ]);

    const loaded = await quotes.load(res.quoteId, user.userId);
    expect(loaded).toEqual(res.quote);
    if (!loaded) throw new Error("stored quote did not load");
    expect(quotes.hashQuote(loaded)).toMatch(/^[a-f0-9]{64}$/);

    const ttl = await ctx.redis.ttl(`billing:quote:${res.quoteId}`);
    expect(ttl).toBeGreaterThan(14 * 60);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
  });

  it("loads a quote for its owner only, and refuses one that was edited", async () => {
    const owner = await ctx.harness.signedInUser();
    const other = await ctx.harness.signedInUser();
    const res = await okQuote(owner, { planKey: "plus", months: 1 });

    expect(await quotes.load(res.quoteId, other.userId)).toBeNull();
    expect(await quotes.load(randomUUID(), owner.userId)).toBeNull();
    expect(await quotes.load("not-a-uuid", owner.userId)).toBeNull();

    const key = `billing:quote:${res.quoteId}`;
    const raw = JSON.parse((await ctx.redis.get(key)) ?? "{}") as {
      quote: { totalMinor: number };
    };
    raw.quote.totalMinor = 1;
    await ctx.redis.set(key, JSON.stringify(raw), "KEEPTTL");
    expect(await quotes.load(res.quoteId, owner.userId)).toBeNull();
  });

  it("refuses an edit that adds a field the schema does not know", async () => {
    const owner = await ctx.harness.signedInUser();
    const res = await okQuote(owner, { planKey: "plus", months: 1 });
    const key = `billing:quote:${res.quoteId}`;
    const raw = JSON.parse((await ctx.redis.get(key)) ?? "{}") as {
      quote: Record<string, unknown>;
    };
    raw.quote["extra"] = true;
    await ctx.redis.set(key, JSON.stringify(raw), "KEEPTTL");
    expect(await quotes.load(res.quoteId, owner.userId)).toBeNull();
  });
});

describe("what can be bought", () => {
  it("answers 404 for a hidden plan, an organization plan and an unknown plan", async () => {
    const user = await ctx.harness.signedInUser();
    for (const planKey of ["clinic", "free_but_missing"]) {
      const res = await quoteAs(user, { planKey, months: 1 });
      expect(res.statusCode, planKey).toBe(404);
      expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    }
    // Public but meant for organizations.
    await ctx.owner.db.update(plans).set({ visibility: "public" }).where(eq(plans.key, "clinic"));
    const org = await quoteAs(user, { planKey: "clinic", months: 1 });
    await ctx.owner.db.update(plans).set({ visibility: "hidden" }).where(eq(plans.key, "clinic"));
    expect(org.statusCode).toBe(404);
  });

  it("answers 422 PRICE_NOT_AVAILABLE for a period or currency without a price", async () => {
    const user = await ctx.harness.signedInUser();
    const period = await quoteAs(user, { planKey: "plus", months: 3 });
    expect(period.statusCode).toBe(422);
    expect(period.json()).toMatchObject({ code: "PRICE_NOT_AVAILABLE" });
    const currency = await quoteAs(
      user,
      { planKey: "plus", months: 1 },
      "/billing/quote?currency=USD",
    );
    expect(currency.statusCode).toBe(422);
    expect(currency.json()).toMatchObject({ code: "PRICE_NOT_AVAILABLE" });
  });
});

describe("payment methods", () => {
  it("adds the grossed-up fee of the chosen method to the total", async () => {
    const user = await ctx.harness.signedInUser();
    await ctx.owner.db
      .update(paymentMethods)
      .set({ feeBps: 500 })
      .where(eq(paymentMethods.key, "vodafone_cash"));
    try {
      const free = await okQuote(user, { planKey: "plus", months: 1, methodKey: "instapay" });
      expect(free.quote).toMatchObject({
        feeMinor: 0,
        totalMinor: PLUS_MONTH,
        methodKey: "instapay",
      });
      const fee = await okQuote(user, { planKey: "plus", months: 1, methodKey: "vodafone_cash" });
      // ceil(9900 / 0.95) = 10422
      expect(fee.quote).toMatchObject({ feeMinor: 522, totalMinor: 10_422 });
      expect(fee.quote.display.feeLine.show).toBe(true);
    } finally {
      await ctx.owner.db
        .update(paymentMethods)
        .set({ feeBps: 0 })
        .where(eq(paymentMethods.key, "vodafone_cash"));
    }
  });

  it("answers 422 METHOD_NOT_AVAILABLE for an unknown or disabled method", async () => {
    const user = await ctx.harness.signedInUser();
    for (const methodKey of ["nope_method", "kashier_card"]) {
      const res = await quoteAs(user, { planKey: "plus", months: 1, methodKey });
      expect(res.statusCode, methodKey).toBe(422);
      expect(res.json()).toMatchObject({ code: "METHOD_NOT_AVAILABLE" });
    }
  });
});

describe("coupons", () => {
  it("applies a valid code and says so", async () => {
    const user = await ctx.harness.signedInUser();
    const coupon = await newCoupon();
    const res = await okQuote(user, {
      planKey: "plus",
      months: 1,
      couponCode: ` ${coupon.code.toLowerCase()} `,
    });
    expect(res.coupon).toEqual({ status: "applied" });
    expect(res.quote.applied.couponId).toBe(coupon.id);
    expect(res.quote.totalMinor).toBe(PLUS_MONTH - 990);
  });

  it("answers every unusable code with the same generic outcome, never a 4xx", async () => {
    const owner = await ctx.harness.signedInUser();
    const other = await ctx.harness.signedInUser();
    const past = (days: number) => new Date(Date.now() - days * DAY);
    const unusable = [
      "NOSUCHCODE",
      (await newCoupon({ startsAt: past(2), endsAt: past(1) })).code,
      (await newCoupon({ maxRedemptions: 1, redeemedCount: 1 })).code,
      (await newCoupon({ targetUserId: other.userId })).code,
      (await newCoupon({ status: "paused" })).code,
      (await newCoupon({ planIds: [planId("pro")] })).code,
    ];
    for (const couponCode of unusable) {
      const res = await okQuote(owner, { planKey: "plus", months: 1, couponCode });
      expect(res.coupon, couponCode).toEqual({ status: "invalid" });
      expect(res.quote.totalMinor).toBe(PLUS_MONTH);
    }
  });

  it("tells an eligible user when a code starts, and only then", async () => {
    const user = await ctx.harness.signedInUser();
    const other = await ctx.harness.signedInUser();
    const startsAt = new Date(Date.now() + 2 * DAY);
    const open = await newCoupon({ startsAt, status: "scheduled" });
    const mine = await newCoupon({ startsAt, status: "scheduled", targetUserId: user.userId });

    const later = await okQuote(user, { planKey: "plus", months: 1, couponCode: open.code });
    expect(later.coupon).toEqual({ status: "invalid", startsAt: startsAt.toISOString() });
    const targeted = await okQuote(user, { planKey: "plus", months: 1, couponCode: mine.code });
    expect(targeted.coupon).toEqual({ status: "invalid", startsAt: startsAt.toISOString() });
    // The same code, but meant for someone else: no date, no hint it exists.
    const stranger = await okQuote(other, { planKey: "plus", months: 1, couponCode: mine.code });
    expect(stranger.coupon).toEqual({ status: "invalid" });
  });

  it("honours the per-owner limit", async () => {
    const user = await ctx.harness.signedInUser();
    const coupon = await newCoupon({ perOwnerLimit: 1 });
    const [order] = await ctx.owner.db
      .insert(orders)
      .values(paidOrder(user.userId, { status: "pending_payment" }))
      .returning({ id: orders.id });
    if (!order) throw new Error("order insert failed");
    await ctx.owner.db
      .insert(couponRedemptions)
      .values({ couponId: coupon.id, orderId: order.id, ownerUserId: user.userId });
    const res = await okQuote(user, { planKey: "plus", months: 1, couponCode: coupon.code });
    expect(res.coupon).toEqual({ status: "invalid" });
  });

  it("reports not_applied when a better discount won", async () => {
    const user = await ctx.harness.signedInUser();
    const promo = await newPromotion({ value: 3_000, planIds: [planId("plus")] });
    try {
      const coupon = await newCoupon({ value: 1_000 });
      const res = await okQuote(user, { planKey: "plus", months: 1, couponCode: coupon.code });
      expect(res.coupon).toEqual({ status: "not_applied" });
      expect(res.quote.applied).toEqual({ promotionId: promo });
      expect(res.quote.totalMinor).toBe(PLUS_MONTH - 2_970);
    } finally {
      await endPromotion(promo);
    }
  });

  it("limits code checks to 10 a minute per user", async () => {
    const user = await ctx.harness.signedInUser();
    for (let i = 0; i < 10; i += 1) {
      const res = await quoteAs(user, { planKey: "plus", months: 1, couponCode: "NOSUCHCODE" });
      expect(res.statusCode, `check ${String(i + 1)}`).toBe(200);
    }
    const limited = await quoteAs(user, { planKey: "plus", months: 1, couponCode: "NOSUCHCODE" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    // Quotes without a code are not affected.
    expect((await quoteAs(user, { planKey: "plus", months: 1 })).statusCode).toBe(200);
  });

  it("counts code checks per address as well (30 a minute)", async () => {
    const user = await ctx.harness.signedInUser();
    const ip = "10.77.7.7";
    for (let i = 0; i < 2; i += 1) {
      const res = await ctx.harness.call("POST", "/billing/quote", {
        jar: user.jar,
        ip,
        body: { planKey: "plus", months: 1, couponCode: "NOSUCHCODE" },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(await ctx.redis.get(`auth:rl:coupon:ip:${ip}`)).toBe("2");
  });
});

function paidOrder(
  userId: string,
  extra: Partial<typeof orders.$inferInsert> = {},
): typeof orders.$inferInsert {
  return {
    ownerUserId: userId,
    kind: "subscription",
    planId: planId("plus"),
    months: 1,
    currency: "EGP",
    quote: {},
    quoteHash: "a".repeat(64),
    subtotalMinor: PLUS_MONTH,
    totalMinor: PLUS_MONTH,
    status: "paid",
    paidAt: new Date(),
    expiresAt: new Date(Date.now() + DAY),
    ...extra,
  };
}

describe("history", () => {
  it("stops new-customer promotions after a paid order", async () => {
    const user = await ctx.harness.signedInUser();
    const promo = await newPromotion({ value: 5_000, newCustomersOnly: true });
    try {
      const first = await okQuote(user, { planKey: "plus", months: 1 });
      expect(first.quote.applied.promotionId).toBe(promo);
      expect(first.quote.totalMinor).toBe(PLUS_MONTH - 4_950);

      await ctx.owner.db.insert(orders).values(paidOrder(user.userId));
      const again = await okQuote(user, { planKey: "plus", months: 1 });
      expect(again.quote.applied.promotionId).toBeUndefined();
      expect(again.quote.totalMinor).toBe(PLUS_MONTH);
    } finally {
      await endPromotion(promo);
    }
  });

  it("credits the unused part of a paid plan when upgrading to a bigger one", async () => {
    const user = await ctx.harness.signedInUser();
    const now = Date.now();
    await ctx.owner.db.insert(orders).values(paidOrder(user.userId));
    await ctx.owner.db.insert(subscriptions).values({
      ownerUserId: user.userId,
      planId: planId("plus"),
      status: "active",
      source: "paid",
      currentPeriodStart: new Date(now - 10 * DAY),
      currentPeriodEnd: new Date(now + 20 * DAY),
      monthsPaid: 1,
    });
    const up = await okQuote(user, { planKey: "pro", months: 1 });
    // 9900 / 30 days = 330 a day, 20 days left.
    const proration = up.quote.lines.find((line) => line.kind === "proration");
    expect(proration?.amountMinor).toBe(-6_600);
    expect(up.quote.subtotalMinor).toBe(29_900 - 6_600);

    // No credit for a plan that is not bigger.
    const same = await okQuote(user, { planKey: "plus", months: 1 });
    expect(same.quote.lines.some((line) => line.kind === "proration")).toBe(false);
  });

  it("applies the user's own unexpired personal offer, and not an expired one", async () => {
    const user = await ctx.harness.signedInUser();
    const template = await newPromotion({
      value: 2_500,
      name: "Welcome template",
      status: "draft",
    });
    const [offer] = await ctx.owner.db
      .insert(personalOffers)
      .values({
        ownerUserId: user.userId,
        kind: "welcome",
        promotionId: template,
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: personalOffers.id });
    const [stale] = await ctx.owner.db
      .insert(personalOffers)
      .values({
        ownerUserId: user.userId,
        kind: "winback",
        promotionId: template,
        expiresAt: new Date(Date.now() - 3_600_000),
      })
      .returning({ id: personalOffers.id });
    expect(stale).toBeDefined();

    const res = await okQuote(user, { planKey: "plus", months: 1 });
    expect(res.quote.applied).toEqual({ personalOfferId: offer?.id });
    expect(res.quote.totalMinor).toBe(PLUS_MONTH - 2_475);

    // Someone else does not get it.
    const other = await ctx.harness.signedInUser();
    expect((await okQuote(other, { planKey: "plus", months: 1 })).quote.applied).toEqual({});

    await ctx.owner.db
      .update(personalOffers)
      .set({ consumedAt: new Date() })
      .where(eq(personalOffers.ownerUserId, user.userId));
    expect((await okQuote(user, { planKey: "plus", months: 1 })).quote.applied).toEqual({});
  });
});

describe("GET /me/recommendation", () => {
  const ask = (who: Pick<Person, "jar">) =>
    ctx.harness.call("GET", "/me/recommendation", { jar: who.jar });

  it("answers 401 without a session", async () => {
    expect((await ctx.harness.call("GET", "/me/recommendation")).statusCode).toBe(401);
  });

  it("recommends nothing for a user who has used no credits", async () => {
    const user = await ctx.harness.signedInUser();
    const res = await ask(user);
    expect(res.statusCode, res.body).toBe(200);
    expect(recommendationResponseSchema.parse(res.json())).toEqual({
      usage30dCredits: 0,
      currency: "EGP",
      recommended: null,
      packPerCreditMinor: 47,
      currentPlanKey: "free",
    });
  });

  it("recommends the cheapest plan that covers 140 credits, with per-credit numbers", async () => {
    const user = await ctx.harness.signedInUser();
    const owner = { type: "user", id: user.userId } as const;
    const credits = ctx.app.get(CreditsService);
    await credits.grant(owner, 200, "2026-10");
    const { reservation } = await credits.reserve(owner, 140, {
      idempotencyKey: `rec-${randomUUID()}`,
      purpose: "test",
    });
    await credits.settle(reservation.id, 140);

    const res = await ask(user);
    expect(res.statusCode, res.body).toBe(200);
    expect(recommendationResponseSchema.parse(res.json())).toEqual({
      usage30dCredits: 140,
      currency: "EGP",
      // 9900 / 150 credits
      recommended: { planKey: "plus", months: 1, amountMinor: PLUS_MONTH, perCreditMinor: 66 },
      packPerCreditMinor: 47,
      currentPlanKey: "free",
    });
  });

  it("has no pack price to compare in a currency without packs", async () => {
    const user = await ctx.harness.signedInUser();
    const res = await ctx.harness.call("GET", "/me/recommendation?currency=SAR", { jar: user.jar });
    expect(res.json()).toMatchObject({ currency: "SAR", packPerCreditMinor: null });
  });
});

describe("rate limit", () => {
  it("limits quotes to 30 a minute", async () => {
    const user = await ctx.harness.signedInUser();
    await expectRateLimited(ctx.harness, {
      method: "POST",
      url: "/billing/quote",
      max: 30,
      jar: user.jar,
      body: { planKey: "plus", months: 1 },
    });
  });
});
