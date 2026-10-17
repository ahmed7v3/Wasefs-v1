import { randomUUID } from "node:crypto";

import { coupons, plans, promotions } from "@wasfa/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Person } from "./support/admin-context.js";
import { randomIp } from "./support/identity-fixtures.js";

const ctx = new AdminTestContext();
let proId: string;
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  await ctx.owner.db.update(plans).set({ visibility: "public" }).where(eq(plans.key, "plus"));
  await ctx.owner.db.update(plans).set({ visibility: "public" }).where(eq(plans.key, "pro"));
  const rows = await ctx.owner.db.select({ id: plans.id, key: plans.key }).from(plans);
  proId = planId(rows, "pro");
}, 180_000);

function planId(rows: { id: string; key: string }[], key: string): string {
  const row = rows.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`plan ${key} missing`);
  return row.id;
}

afterAll(async () => {
  await ctx.stop();
});

async function addCoupon(extra: Partial<typeof coupons.$inferInsert> = {}) {
  const code = `CHECK-${String(++counter)}-${randomUUID().slice(0, 5).toUpperCase()}`;
  const [row] = await ctx.owner.db
    .insert(coupons)
    .values({
      code,
      kind: "percent",
      name: `Coupon ${String(counter)}`,
      titleAr: "كوبون",
      titleEn: "Coupon",
      value: 1_000,
      status: "active",
      ...extra,
    })
    .returning({ id: coupons.id });
  if (!row) throw new Error("coupon insert failed");
  return { ...row, code };
}

async function check(who: Person, code: string, body: Record<string, unknown> = {}, ip?: string) {
  return ctx.harness.call("POST", "/billing/coupons/check", {
    jar: who.jar,
    ...(ip ? { ip } : {}),
    body: { code, planKey: "plus", months: 1, ...body },
  });
}

async function createUse(who: Person, code: string) {
  const quote = await ctx.harness.call("POST", "/billing/quote", {
    jar: who.jar,
    body: { planKey: "plus", months: 1, couponCode: code },
    ip: randomIp(),
  });
  expect(quote.statusCode, quote.body).toBe(200);
  return ctx.harness.call("POST", "/billing/orders", {
    jar: who.jar,
    body: { quoteId: quote.json<{ quoteId: string }>().quoteId },
    ip: randomIp(),
  });
}

describe("POST /billing/coupons/check", () => {
  it("lists only in-force pricing promotions in the public catalog, without internal fields", async () => {
    const base = {
      kind: "percent" as const,
      titleAr: "عرض",
      titleEn: "Public title",
      value: 500,
      showOnPricing: true,
    };
    const day = 86_400_000;
    const rows = await ctx.owner.db
      .insert(promotions)
      .values([
        { ...base, name: "Internal live", status: "active" as const },
        { ...base, name: "Internal paused", status: "paused" as const },
        { ...base, name: "Internal ended", status: "ended" as const },
        {
          ...base,
          name: "Internal future",
          status: "scheduled" as const,
          startsAt: new Date(Date.now() + day),
        },
        { ...base, name: "Internal hidden", status: "active" as const, showOnPricing: false },
      ])
      .returning({ id: promotions.id, name: promotions.name });
    const idOf = (name: string) => rows.find((row) => row.name === name)?.id;

    const response = await ctx.harness.call("GET", "/catalog?currency=EGP");
    expect(response.statusCode).toBe(200);
    const listed = response.json<{ promotions: Record<string, unknown>[] }>().promotions;
    const ids = listed.map((item) => item.id);
    expect(ids).toContain(idOf("Internal live"));
    for (const hidden of ["paused", "ended", "future", "hidden"]) {
      expect(ids).not.toContain(idOf(`Internal ${hidden}`));
    }
    expect(listed.find((item) => item.id === idOf("Internal live"))).toEqual({
      id: idOf("Internal live"),
      title: { ar: "عرض", en: "Public title" },
      badge: null,
      endsAt: null,
    });
    expect(JSON.stringify(response.json())).not.toContain("Internal");
    await ctx.owner.db
      .update(promotions)
      .set({ status: "ended" })
      .where(
        inArray(
          promotions.id,
          rows.map((row) => row.id),
        ),
      );
  });

  it("returns applied and not_applied using the quote's discount choice", async () => {
    const who = await ctx.harness.signedInUser();
    const applicable = await addCoupon({ value: 4_000 });
    const applied = await check(who, applicable.code);
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toEqual({ status: "applied" });

    const [betterPromotion] = await ctx.owner.db
      .insert(promotions)
      .values({
        kind: "percent",
        name: "Better public promotion",
        titleAr: "عرض",
        titleEn: "Promotion",
        value: 6_000,
        status: "active",
      })
      .returning({ id: promotions.id });
    const weakerCoupon = await addCoupon({ value: 1_000 });
    const notApplied = await check(who, weakerCoupon.code);
    expect(notApplied.statusCode).toBe(200);
    expect(notApplied.json()).toEqual({ status: "not_applied" });
    await ctx.owner.db
      .update(promotions)
      .set({ status: "ended" })
      .where(eq(promotions.id, betterPromotion?.id ?? randomUUID()));
  });

  it("makes all unusable coupons byte-identical and hides a future date from an ineligible plan", async () => {
    const who = await ctx.harness.signedInUser();
    const other = await ctx.harness.signedInUser();
    const cases = [
      await addCoupon({ status: "ended" }),
      await addCoupon({ status: "paused" }),
      await addCoupon({ endsAt: new Date(Date.now() - 1_000) }),
      await addCoupon({ maxRedemptions: 1, redeemedCount: 1 }),
      await addCoupon({ targetUserId: other.userId }),
      await addCoupon({ planIds: [proId] }),
      await addCoupon({ countries: ["US"] }),
    ];
    const responses = [await check(who, "MISSING-COUPON")];
    for (const coupon of cases) responses.push(await check(who, coupon.code));
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(responses[0]?.body).toBe('{"status":"invalid"}');

    const future = await addCoupon({
      status: "scheduled",
      startsAt: new Date(Date.now() + 86_400_000),
      planIds: [proId],
      targetUserId: who.userId,
    });
    const wrongPlan = await check(who, future.code);
    expect(wrongPlan.json()).toEqual({ status: "invalid" });
    const eligible = await addCoupon({
      status: "scheduled",
      startsAt: new Date(Date.now() + 86_400_000),
    });
    expect(await check(who, eligible.code).then((res) => res.json())).toEqual({
      status: "invalid",
      startsAt: expect.any(String),
    });
    expect(await check(other, future.code).then((res) => res.json())).toEqual({
      status: "invalid",
    });
  });

  it("hides per-owner exhausted coupons, returns NOT_FOUND for unknown plans, requires login and rate limits users", async () => {
    const who = await ctx.harness.signedInUser();
    const limited = await addCoupon({ value: 10_000, perOwnerLimit: 1 });
    expect((await createUse(who, limited.code)).statusCode).toBe(201);
    const exhausted = await check(who, limited.code, {}, randomIp());
    expect(exhausted.statusCode).toBe(200);
    expect(exhausted.body).toBe('{"status":"invalid"}');

    const unknownPlan = await check(who, "UNKNOWN-CODE", { planKey: "does_not_exist" });
    expect(unknownPlan.statusCode).toBe(404);
    expect(unknownPlan.json()).toMatchObject({ code: "NOT_FOUND" });
    const anonymous = await ctx.harness.call("POST", "/billing/coupons/check", {
      body: { code: "UNKNOWN-CODE", planKey: "plus", months: 1 },
    });
    expect(anonymous.statusCode).toBe(401);

    const throttledCoupon = await addCoupon();
    const rateLimitedUser = await ctx.harness.signedInUser();
    let response;
    for (let index = 0; index < 10; index++) {
      response = await check(rateLimitedUser, throttledCoupon.code, {}, randomIp());
      expect(response.statusCode).toBe(200);
    }
    response = await check(rateLimitedUser, throttledCoupon.code, {}, randomIp());
    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: "RATE_LIMITED" });
  });
});
