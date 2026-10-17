import { randomUUID } from "node:crypto";

import { coupons, expireOrders, orders, paymentMethods, plans } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Person } from "./support/admin-context.js";
import { randomIp } from "./support/identity-fixtures.js";

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
  await ctx.owner.db.update(plans).set({ visibility: "public" }).where(eq(plans.key, "plus"));
  await ctx.owner.db.insert(paymentMethods).values({
    key: "coupon_test_manual",
    kind: "manual",
    provider: "manual",
    nameAr: "طريقة اختبار",
    nameEn: "Coupon test method",
    currencies: ["EGP"],
    countries: null,
    enabled: true,
    sort: 999,
  });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function newCoupon(maxRedemptions: number, perOwnerLimit?: number) {
  const code = `RACE-${randomUUID().slice(0, 8).toUpperCase()}`;
  const [row] = await ctx.owner.db
    .insert(coupons)
    .values({
      code,
      kind: "percent",
      name: "Concurrent coupon",
      titleAr: "كوبون",
      titleEn: "Coupon",
      value: 1_000,
      status: "active",
      maxRedemptions,
      ...(perOwnerLimit ? { perOwnerLimit } : {}),
    })
    .returning({ id: coupons.id });
  if (!row) throw new Error("coupon insert failed");
  return { ...row, code };
}

async function storedQuote(who: Person, code: string) {
  const res = await ctx.harness.call("POST", "/billing/quote", {
    jar: who.jar,
    ip: randomIp(),
    body: { planKey: "plus", months: 1, couponCode: code, methodKey: "coupon_test_manual" },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{ quoteId: string }>().quoteId;
}

async function createOrder(who: Person, quoteId: string) {
  return ctx.harness.call("POST", "/billing/orders", {
    jar: who.jar,
    ip: randomIp(),
    body: { quoteId, methodKey: "coupon_test_manual" },
  });
}

describe("coupon reservation through concurrent API orders", () => {
  it("creates exactly the ten orders allowed by a 10-use coupon", async () => {
    const coupon = await newCoupon(10);
    const customers = await Promise.all(
      Array.from({ length: 100 }, () => ctx.harness.signedInUser()),
    );
    const responses = await Promise.all(
      customers.map(async (customer) =>
        createOrder(customer, await storedQuote(customer, coupon.code)),
      ),
    );
    const created = responses.filter((response) => response.statusCode === 201);
    const refused = responses.filter((response) => response.statusCode === 409);
    expect(created).toHaveLength(10);
    expect(refused).toHaveLength(90);
    expect(
      refused.every((response) => response.json<{ code: string }>().code === "COUPON_UNAVAILABLE"),
    ).toBe(true);
    const [stored] = await ctx.owner.db.select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(stored?.redeemedCount).toBe(10);
  }, 300_000);

  it("refuses a second prequoted order for one owner and frees a slot after expiry", async () => {
    const coupon = await newCoupon(10, 1);
    const owner = await ctx.harness.signedInUser();
    const quoteOne = await storedQuote(owner, coupon.code);
    const quoteTwo = await storedQuote(owner, coupon.code);
    expect((await createOrder(owner, quoteOne)).statusCode).toBe(201);
    const second = await createOrder(owner, quoteTwo);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: "COUPON_UNAVAILABLE" });

    const singleUse = await newCoupon(1);
    const expiringOwner = await ctx.harness.signedInUser();
    const quoteId = await storedQuote(expiringOwner, singleUse.code);
    const created = await createOrder(expiringOwner, quoteId);
    expect(created.statusCode).toBe(201);
    const orderId = created.json<{ orderId: string }>().orderId;
    await ctx.owner.db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(orders.id, orderId));
    const expired = await expireOrders(ctx.owner.db, new Date());
    expect(expired.expired).toBeGreaterThan(0);
    const [releasedCoupon] = await ctx.owner.db
      .select()
      .from(coupons)
      .where(eq(coupons.id, singleUse.id));
    expect(releasedCoupon?.redeemedCount).toBe(0);

    const replacementOwner = await ctx.harness.signedInUser();
    const replacementQuote = await storedQuote(replacementOwner, singleUse.code);
    expect((await createOrder(replacementOwner, replacementQuote)).statusCode).toBe(201);
  }, 300_000);
});
