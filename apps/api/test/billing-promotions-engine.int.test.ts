import { randomUUID } from "node:crypto";

import { coupons, plans, promotions } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Person } from "./support/admin-context.js";

const ctx = new AdminTestContext();
let planId: string;

beforeAll(async () => {
  await ctx.start();
  const [plan] = await ctx.owner.db
    .update(plans)
    .set({ visibility: "public" })
    .where(eq(plans.key, "plus"))
    .returning({ id: plans.id });
  if (!plan) throw new Error("plus plan missing");
  planId = plan.id;
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function quote(who: Person, couponCode?: string) {
  const res = await ctx.harness.call("POST", "/billing/quote", {
    jar: who.jar,
    body: { planKey: "plus", months: 1, ...(couponCode ? { couponCode } : {}) },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{
    quote: {
      subtotalMinor: number;
      display: { savingsBps: number };
      applied: Record<string, string>;
    };
  }>().quote;
}

async function addPromotion(
  value: number,
  stacking: "exclusive" | "stack_with_other" = "exclusive",
) {
  const [row] = await ctx.owner.db
    .insert(promotions)
    .values({
      kind: "percent",
      name: `API engine ${randomUUID()}`,
      titleAr: "عرض",
      titleEn: "Promotion",
      value,
      stacking,
      status: "active",
      planIds: [planId],
    })
    .returning({ id: promotions.id });
  if (!row) throw new Error("promotion insert failed");
  return row.id;
}

describe("discount selection through the quote API", () => {
  it("chooses the larger exclusive saving and gives the coupon a tie", async () => {
    const who = await ctx.harness.signedInUser();
    const smaller = await addPromotion(2_000);
    const larger = await addPromotion(5_000);
    const couponCode = `TIE-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [coupon] = await ctx.owner.db
      .insert(coupons)
      .values({
        code: couponCode,
        kind: "percent",
        name: "Tie coupon",
        titleAr: "كوبون",
        titleEn: "Coupon",
        value: 5_000,
        status: "active",
        planIds: [planId],
      })
      .returning({ id: coupons.id });
    if (!coupon) throw new Error("coupon insert failed");
    try {
      expect((await quote(who)).applied.promotionId).toBe(larger);
      expect((await quote(who, couponCode)).applied.couponId).toBe(coupon.id);
      expect((await quote(who, couponCode)).applied.promotionId).toBeUndefined();
    } finally {
      await ctx.owner.db
        .update(promotions)
        .set({ status: "ended" })
        .where(eq(promotions.id, smaller));
      await ctx.owner.db
        .update(promotions)
        .set({ status: "ended" })
        .where(eq(promotions.id, larger));
      await ctx.owner.db.update(coupons).set({ status: "ended" }).where(eq(coupons.id, coupon.id));
    }
  });

  it("combines stack_with_other discounts up to the configured total cap", async () => {
    const who = await ctx.harness.signedInUser();
    const first = await addPromotion(5_000, "stack_with_other");
    const second = await addPromotion(5_000, "stack_with_other");
    try {
      const result = await quote(who);
      expect(result.applied.promotionId).toBeDefined();
      expect(result.display.savingsBps).toBe(7_000);
      expect(result.subtotalMinor).toBe(2_970);
    } finally {
      await ctx.owner.db
        .update(promotions)
        .set({ status: "ended" })
        .where(eq(promotions.id, first));
      await ctx.owner.db
        .update(promotions)
        .set({ status: "ended" })
        .where(eq(promotions.id, second));
    }
  });
});
