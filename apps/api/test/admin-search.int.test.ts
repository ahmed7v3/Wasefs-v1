import { auditLogs, coupons, referralCodes, referralPrograms } from "@wasfa/db";
import { adminSearchResponseSchema } from "@wasfa/shared/schemas/admin-billing-console";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";
import { insertOrder, insertPayment } from "./support/billing-console-fixtures.js";

import type { Order, Payment } from "@wasfa/db";

/*
 * The admin search palette (Task 3.8): every group is found by a fragment, a group is only queried
 * for a caller who holds its permission, user contact data is masked, and the audit row records how
 * many users were shown, never what was typed.
 */

const ctx = new AdminTestContext();
let boss: Admin;
let userId: string;
let order: Order;
let payment: Payment;
let couponId: string;
let referralCodeId: string;

const EMAIL = "quark.sample@example.com";
const PHONE = "+201234567890";

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  userId = await ctx.insertUser({ name: "Zed Quark", email: EMAIL, phone: PHONE });
  order = await insertOrder(ctx, { ownerUserId: userId, subtotalMinor: 9_900 });
  payment = await insertPayment(ctx, { order });
  const [coupon] = await ctx.owner.db
    .insert(coupons)
    .values({
      code: "QUARKSAVE",
      kind: "percent",
      name: "Quark",
      titleAr: "كواركي",
      titleEn: "Quark",
      value: 1_000,
      status: "active",
    })
    .returning({ id: coupons.id });
  couponId = coupon?.id ?? "";
  const [program] = await ctx.owner.db
    .insert(referralPrograms)
    .values({ key: "search_prog", kind: "standard", nameAr: "ب", nameEn: "P" })
    .returning({ id: referralPrograms.id });
  const [code] = await ctx.owner.db
    .insert(referralCodes)
    .values({ code: "QUARKREF", kind: "campaign", programId: program?.id ?? "" })
    .returning({ id: referralCodes.id });
  referralCodeId = code?.id ?? "";
}, 180_000);

afterAll(async () => ctx.stop());

async function search(who: { jar: Admin["jar"] }, q: string) {
  const response = await ctx.harness.call("GET", `/admin/search?q=${encodeURIComponent(q)}`, {
    jar: who.jar,
  });
  expect(response.statusCode, response.body).toBe(200);
  return adminSearchResponseSchema.parse(response.json()).items;
}

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("GET /admin/search", () => {
  it("needs at least two characters", async () => {
    for (const q of ["s", " a ", ""]) {
      const response = await ctx.harness.call("GET", `/admin/search?q=${encodeURIComponent(q)}`, {
        jar: boss.jar,
      });
      expect(response.statusCode, q).toBe(400);
    }
  });

  it("finds a user by e-mail, name, phone and id fragments, with a link to the user page", async () => {
    const fragments = [
      "QUARK.SAMPLE", // case-insensitive e-mail prefix
      "zed qu", // name prefix
      "01234567890", // national number with the trunk zero
      "١٢٣٤٥٦٧٨٩٠", // the same digits typed in Arabic-Indic numerals
      "+201234567890", // the full E.164 number
      userId.slice(0, 8), // id prefix
    ];
    for (const fragment of fragments) {
      const items = await search(boss, fragment);
      expect(items, fragment).toContainEqual({
        type: "user",
        id: userId,
        title: "Zed Quark",
        subtitle: expect.any(String),
        href: `/admin/users/${userId}`,
      });
    }
  });

  it("shows only masked contact details of a user", async () => {
    const response = await ctx.harness.call("GET", "/admin/search?q=quark.sample", {
      jar: boss.jar,
    });
    const body = response.body;
    expect(body).not.toContain(EMAIL);
    expect(body).not.toContain("1234567890");
    expect(body).toContain("q***@example.com");
    const [user] = adminSearchResponseSchema.parse(response.json()).items;
    expect(user?.subtitle).toMatch(/^\+20\*+890 · q\*\*\*@example\.com$/);
  });

  it("finds orders and payments by number or reference, with or without the prefix", async () => {
    const withoutPrefix = order.number.slice("WSO-".length, "WSO-".length + 7);
    for (const fragment of [order.number, order.number.toLowerCase(), withoutPrefix]) {
      expect(ids(await search(boss, fragment)), fragment).toContain(order.id);
    }
    expect(ids(await search(boss, order.id.slice(0, 8)))).toContain(order.id);
    const found = (await search(boss, order.number)).find((item) => item.id === order.id);
    expect(found).toMatchObject({
      type: "order",
      title: order.number,
      href: `/admin/billing/orders?open=${order.id}`,
    });

    const referenceTail = payment.reference.slice("WSP-".length, "WSP-".length + 4);
    for (const fragment of [payment.reference, payment.reference.toLowerCase(), referenceTail]) {
      expect(ids(await search(boss, fragment)), fragment).toContain(payment.id);
    }
    expect(ids(await search(boss, payment.id.slice(0, 8)))).toContain(payment.id);
    expect(
      (await search(boss, payment.reference)).find((item) => item.id === payment.id),
    ).toMatchObject({
      type: "payment",
      href: `/admin/billing/payments?open=${payment.id}`,
    });
  });

  it("finds coupons and referral codes by an upper-cased prefix", async () => {
    const coupon = (await search(boss, "quarks")).find((item) => item.id === couponId);
    expect(coupon).toMatchObject({
      type: "coupon",
      title: "QUARKSAVE",
      href: `/admin/billing/coupons?open=${couponId}`,
    });
    const referral = (await search(boss, "quarkr")).find((item) => item.id === referralCodeId);
    expect(referral).toMatchObject({
      type: "referral_code",
      title: "QUARKREF",
      href: `/admin/growth/referrals?code=${referralCodeId}`,
    });
  });

  it("returns at most five results per group", async () => {
    for (let i = 0; i < 7; i++) {
      await ctx.insertUser({
        name: `Bulk Person ${String(i)}`,
        email: `bulk-${String(i)}@example.com`,
      });
    }
    const users = (await search(boss, "bulk")).filter((item) => item.type === "user");
    expect(users).toHaveLength(5);
  });

  it("queries a group only for a caller who holds its permission", async () => {
    const billing = await ctx.admin(await ctx.customRole(["billing.read"]));
    const users = await ctx.admin(await ctx.customRole(["users.read"]));
    const referrals = await ctx.admin(await ctx.customRole(["referrals.read"]));

    const billingTypes = async (who: Admin, q: string) =>
      new Set((await search(who, q)).map((item) => item.type));
    expect(await billingTypes(billing, "quark")).toEqual(new Set(["coupon"]));
    expect(ids(await search(billing, order.number))).toContain(order.id);
    expect(ids(await search(billing, payment.reference))).toContain(payment.id);
    expect(ids(await search(billing, "quark.sample"))).not.toContain(userId);

    expect(await billingTypes(users, "quark")).toEqual(new Set(["user"]));
    expect(ids(await search(users, order.number))).not.toContain(order.id);

    expect(await billingTypes(referrals, "quark")).toEqual(new Set(["referral_code"]));
  });

  it("audits only searches that returned users, and never the query text", async () => {
    const actor = await ctx.admin(await ctx.customRole(["users.read", "billing.read"]));
    const audits = () =>
      ctx.owner.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "admin.search"), eq(auditLogs.actorId, actor.userId)));

    await search(actor, order.number);
    expect(await audits()).toHaveLength(0);
    await search(actor, "no-such-thing-anywhere");
    expect(await audits()).toHaveLength(0);

    await search(actor, "bulk");
    const [row] = await audits();
    expect(row?.after).toEqual({ resultCount: 5 });
    expect(JSON.stringify(row)).not.toContain("bulk");
  });

  it("refuses a caller with none of the permissions it accepts", async () => {
    const nobody = await ctx.admin(await ctx.customRole([]));
    const response = await ctx.harness.call("GET", "/admin/search?q=quark", { jar: nobody.jar });
    expect(response.statusCode).toBe(403);
  });
});
