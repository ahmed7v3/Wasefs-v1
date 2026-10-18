import { randomUUID } from "node:crypto";

import { coupons, plans } from "@wasfa/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

const ctx = new AdminTestContext();
let boss: Admin;
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  await ctx.owner.db.update(plans).set({ visibility: "public" }).where(eq(plans.key, "plus"));
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

const call = (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  who = boss,
  body?: Record<string, unknown>,
) => ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function couponBody(extra: Record<string, unknown> = {}) {
  return {
    code: `test-${String(++counter)}-${randomUUID().slice(0, 6)}`,
    name: `Coupon ${String(counter)}`,
    titleAr: "كوبون تجريبي",
    titleEn: "Test coupon",
    kind: "percent",
    value: 1_000,
    ...extra,
  };
}

async function create(extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/admin/billing/coupons", boss, couponBody(extra));
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string; code: string; status: string }>();
}

describe("admin coupon operations", () => {
  it("normalizes single codes and rejects duplicate codes", async () => {
    const input = couponBody({ code: `  lower-${randomUUID().slice(0, 7)}  ` });
    const created = await call("POST", "/admin/billing/coupons", boss, input);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      code: input.code.trim().toUpperCase(),
      status: "draft",
    });
    const duplicate = await call("POST", "/admin/billing/coupons", boss, {
      ...input,
      name: "Second coupon",
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "CONFLICT" });
  });

  it("bulk-generates unique codes, exports CSV, and applies lifecycle transitions by batch", async () => {
    const created = await call("POST", "/admin/billing/coupons/bulk", boss, {
      ...couponBody(),
      count: 50,
      prefix: "BATCH",
      length: 8,
    });
    expect(created.statusCode, created.body).toBe(201);
    const { batch, count } = created.json<{ batch: string; count: number }>();
    expect(count).toBe(50);

    const exported = await ctx.harness.call(
      "GET",
      `/admin/billing/coupons/batches/${batch}/export`,
      {
        jar: boss.jar,
      },
    );
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-type"]).toContain("text/csv; charset=utf-8");
    expect(exported.headers["content-disposition"]).toContain(`coupons-${batch}.csv`);
    const lines = exported.body.trim().split(/\r?\n/);
    expect(lines).toHaveLength(51);
    expect(lines[0]).toBe("code,status,redeemed_count,max_redemptions,starts_at,ends_at");
    const couponRowsBeforePublish = await ctx.owner.db
      .select()
      .from(coupons)
      .where(eq(coupons.batch, batch));
    await ctx.owner.db
      .update(coupons)
      .set({ status: "ended" })
      .where(eq(coupons.id, couponRowsBeforePublish.map((row) => row.id)[0] ?? randomUUID()));

    const published = await call("POST", `/admin/billing/coupons/batches/${batch}/publish`);
    expect(published.json()).toMatchObject({ changed: 49 });
    expect(
      (await call("POST", `/admin/billing/coupons/batches/${batch}/pause`)).json(),
    ).toMatchObject({ changed: 49 });
    expect(
      (await call("POST", `/admin/billing/coupons/batches/${batch}/end`)).json(),
    ).toMatchObject({ changed: 49 });
    expect(
      (await call("POST", `/admin/billing/coupons/batches/${batch}/end`)).json(),
    ).toMatchObject({ changed: 0 });

    const rows = await ctx.owner.db.select().from(coupons).where(eq(coupons.batch, batch));
    expect(rows).toHaveLength(50);
    expect(new Set(rows.map((row) => row.code)).size).toBe(50);
    expect(rows.every((row) => row.status === "ended")).toBe(true);
    expect(await ctx.auditRowsFor("coupon.bulk_created", batch)).toHaveLength(1);
    expect(await ctx.auditRowsFor("coupon.batch_exported", batch)).toHaveLength(1);
  });

  it("shows coupon redemptions in detail and supports a private target", async () => {
    const customer = await ctx.harness.signedInUser();
    const privateCoupon = await create({
      targetUserId: customer.userId,
      value: 10_000,
      perOwnerLimit: 1,
    });
    await call("POST", `/admin/billing/coupons/${privateCoupon.id}/publish`);
    const quote = await ctx.harness.call("POST", "/billing/quote", {
      jar: customer.jar,
      body: { planKey: "plus", months: 1, couponCode: privateCoupon.code },
    });
    expect(quote.statusCode, quote.body).toBe(200);
    const quoteId = quote.json<{ quoteId: string }>().quoteId;
    const order = await ctx.harness.call("POST", "/billing/orders", {
      jar: customer.jar,
      body: { quoteId },
    });
    expect(order.statusCode, order.body).toBe(201);
    const detail = await call("GET", `/admin/billing/coupons/${privateCoupon.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ redemptions: unknown[] }>().redemptions).toHaveLength(1);
    expect(detail.json()).toMatchObject({ targetUserId: customer.userId });
  });

  it("checks read and write permissions and fresh authentication", async () => {
    const row = await create();
    const lackingWrite = await ctx.admin(await ctx.roleLacking("coupons.write"));
    expect((await call("GET", "/admin/billing/coupons", lackingWrite)).statusCode).toBe(200);
    expect(
      (await call("POST", "/admin/billing/coupons", lackingWrite, couponBody())).statusCode,
    ).toBe(403);
    const lackingRead = await ctx.admin(await ctx.roleLacking("billing.read"));
    expect((await call("GET", "/admin/billing/coupons", lackingRead)).statusCode).toBe(403);

    const stale = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stale.userId);
    const publish = await call("POST", `/admin/billing/coupons/${row.id}/publish`, stale);
    expect(publish.statusCode).toBe(401);
    expect(publish.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    const fresh = await ctx.admin("super_admin");
    await call("POST", `/admin/billing/coupons/${row.id}/publish`, fresh);
    await call("POST", `/admin/billing/coupons/${row.id}/pause`, fresh);
    await ctx.makeSessionStale(stale.userId);
    const resume = await call("POST", `/admin/billing/coupons/${row.id}/resume`, stale);
    expect(resume.statusCode).toBe(401);
    expect(resume.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });
});
