import {
  aiUsage,
  creditPackPrices,
  creditPacks,
  paymentGateways,
  paymentMethodAccountChanges,
  paymentMethods,
  planPrices,
  plans,
  subscriptions,
  taxRules,
} from "@wasfa/db";
import { AI_OUTCOMES, AI_TASKS } from "@wasfa/shared/ai";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin } from "./support/admin-context.js";
import { enableFakeCard, planIdOf } from "./support/billing-console-fixtures.js";

/*
 * The catalog side of the admin billing console (Task 3.8): plan prices with their margin, credit
 * packs, payment methods and tax rules. Writes need billing.write, fresh authentication and a
 * reason, are audited, and the method route can never reach the account customers pay into.
 */

const ctx = new AdminTestContext();
let boss: Admin;
let stale: Admin;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  stale = await ctx.admin("super_admin");
  await ctx.makeSessionStale(stale.userId);
  await enableFakeCard(ctx);
}, 180_000);

afterAll(async () => ctx.stop());

type Who = { jar: Admin["jar"] };
const get = (path: string, who: Who = boss) => ctx.harness.call("GET", path, { jar: who.jar });
const send = (
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body: Record<string, unknown>,
  who: Who = boss,
) => ctx.harness.call(method, path, { jar: who.jar, body });

interface PlanView {
  key: string;
  id: string;
  monthlyCredits: number;
  activeSubscribers: number;
  marginInputs: { costPerCreditUsdMicros: number; source: string; fxUsdToEgp: number };
  prices: Array<{ months: number; currency: string; amountMinor: number | null; active: boolean }>;
}

async function plan(key: string): Promise<PlanView> {
  const response = await get("/admin/billing/plans");
  expect(response.statusCode, response.body).toBe(200);
  const found = (response.json().items as PlanView[]).find((item) => item.key === key);
  if (!found) throw new Error(`plan ${key} missing`);
  return found;
}

const priceOf = (view: PlanView, months: number, currency: string) =>
  view.prices.find((price) => price.months === months && price.currency === currency);

describe("plan prices", () => {
  it("lists every plan with its price grid, subscribers and the cost inputs of the margin", async () => {
    const plusId = await planIdOf(ctx, "plus");
    const owner = await ctx.insertUser({ name: "Plus Payer", email: "plus.payer@example.com" });
    await ctx.owner.db.insert(subscriptions).values({
      ownerUserId: owner,
      planId: plusId,
      status: "active",
      source: "paid",
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000),
    });

    const response = await get("/admin/billing/plans");
    expect(response.statusCode).toBe(200);
    const items = response.json().items as PlanView[];
    expect(items.map((item) => item.key)).toEqual(
      expect.arrayContaining(["free", "plus", "pro", "clinic"]),
    );
    const plus = await plan("plus");
    expect(plus.activeSubscribers).toBe(1);
    expect(plus.monthlyCredits).toBe(150);
    expect(priceOf(plus, 1, "EGP")).toMatchObject({ amountMinor: 9_900, active: true });
    expect(priceOf(plus, 12, "EGP")).toMatchObject({ amountMinor: 99_000, active: true });
    // No AI usage yet: the configured credit value stands in for the measured cost.
    expect(plus.marginInputs).toEqual({
      costPerCreditUsdMicros: 10_000,
      source: "credit_value_setting",
      fxUsdToEgp: 50,
    });
    expect((await plan("pro")).activeSubscribers).toBe(0);
  });

  it("measures the cost of a credit from the last 30 days of AI usage when there is some", async () => {
    const task = AI_TASKS[0];
    const outcome = AI_OUTCOMES[0];
    await ctx.owner.db.insert(aiUsage).values([
      { task, modelKey: "m", outcome, costUsdMicros: 90_000, creditsCharged: 10 },
      { task, modelKey: "m", outcome, costUsdMicros: 61_001, creditsCharged: 5 },
      // Older than the window: ignored.
      {
        task,
        modelKey: "m",
        outcome,
        costUsdMicros: 9_000_000,
        creditsCharged: 1,
        createdAt: new Date(Date.now() - 45 * 86_400_000),
      },
    ]);
    const plus = await plan("plus");
    expect(plus.marginInputs).toMatchObject({
      source: "ai_usage_30d",
      // floor(151_001 / 15)
      costPerCreditUsdMicros: 10_066,
    });
    await ctx.owner.db.delete(aiUsage);
  });

  it("previews a change: the diff, the subscribers who keep their price, and a margin per price", async () => {
    const plusId = await planIdOf(ctx, "plus");
    const response = await send("POST", `/admin/billing/plans/${plusId}/prices/preview`, {
      prices: [
        { months: 1, currency: "EGP", amountMinor: 9_900 },
        { months: 12, currency: "EGP", amountMinor: 120_000 },
        { months: 3, currency: "EGP", amountMinor: 27_000 },
        { months: 1, currency: "USD", amountMinor: 500 },
        { months: 1, currency: "SAR", amountMinor: 1_000 },
        { months: 24, currency: "USD", amountMinor: null },
      ],
    });
    expect(response.statusCode, response.body).toBe(201);
    const preview = response.json();
    expect(preview.diff).toEqual({
      added: [
        { months: 3, currency: "EGP", amountMinor: 27_000 },
        { months: 1, currency: "USD", amountMinor: 500 },
        { months: 1, currency: "SAR", amountMinor: 1_000 },
      ],
      changed: [{ months: 12, currency: "EGP", from: 99_000, to: 120_000 }],
      removed: [],
    });
    expect(preview.activeSubscribers).toBe(1);

    // 150 credits x $0.01 = $1.50 = 7,500 piasters at 50 EGP per dollar, no tax, no fee.
    const marginOf = (months: number, currency: string) =>
      preview.margin.find(
        (row: { months: number; currency: string }) =>
          row.months === months && row.currency === currency,
      ).margin;
    expect(marginOf(1, "EGP")).toEqual({
      revenueMonthlyMinor: 9_900,
      costFullMinor: 7_500,
      marginFullMinor: 2_400,
      marginBps: 2_424,
      breakEvenBps: 7_575,
      warn: true,
    });
    expect(marginOf(12, "EGP")).toEqual({
      revenueMonthlyMinor: 10_000,
      costFullMinor: 90_000,
      marginFullMinor: 30_000,
      marginBps: 2_500,
      breakEvenBps: 7_500,
      warn: true,
    });
    expect(marginOf(1, "USD")).toEqual({
      revenueMonthlyMinor: 500,
      costFullMinor: 150,
      marginFullMinor: 350,
      marginBps: 7_000,
      breakEvenBps: 3_000,
      warn: false,
    });
    // No exchange rate for riyals, and nothing to judge for a switched-off cell.
    expect(marginOf(1, "SAR")).toBeNull();
    expect(marginOf(24, "USD")).toBeNull();

    // A preview writes nothing.
    const plus = await plan("plus");
    expect(priceOf(plus, 12, "EGP")?.amountMinor).toBe(99_000);
    expect(priceOf(plus, 3, "EGP")).toBeUndefined();
  });

  it("refuses to publish a price below cost unless the override is explicit", async () => {
    const plusId = await planIdOf(ctx, "plus");
    const path = `/admin/billing/plans/${plusId}/prices`;
    const losing = { prices: [{ months: 1, currency: "EGP", amountMinor: 5_000 }] };

    const blocked = await send("PUT", path, { ...losing, reason: "summer promotion price" });
    expect(blocked.statusCode, blocked.body).toBe(400);
    expect(blocked.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["prices"], negativeMargin: ["1:EGP"] },
    });
    expect(priceOf(await plan("plus"), 1, "EGP")?.amountMinor).toBe(9_900);

    const allowed = await send("PUT", path, {
      ...losing,
      reason: "summer promotion price",
      overrideMargin: true,
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    expect(allowed.json()).toMatchObject({
      published: true,
      diff: { changed: [{ months: 1, currency: "EGP", from: 9_900, to: 5_000 }] },
    });
    expect(priceOf(await plan("plus"), 1, "EGP")?.amountMinor).toBe(5_000);

    const audit = await ctx.auditRowsFor("plan.prices_published", plusId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(boss.userId);
    expect(audit[0]?.after).toMatchObject({
      overrideMargin: true,
      negativeMarginCells: 1,
      reason: "summer promotion price",
      diff: { changed: [{ months: 1, currency: "EGP", from: 9_900, to: 5_000 }] },
    });

    // Restoring a healthy price needs no override; an unchanged losing cell does not block either.
    const restored = await send("PUT", path, {
      prices: [{ months: 1, currency: "EGP", amountMinor: 9_900 }],
      reason: "promotion over",
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(priceOf(await plan("plus"), 1, "EGP")?.amountMinor).toBe(9_900);
  });

  it("switches a price off without deleting it, and back on", async () => {
    const plusId = await planIdOf(ctx, "plus");
    const path = `/admin/billing/plans/${plusId}/prices`;
    const countRows = async () =>
      (await ctx.owner.db.select().from(planPrices).where(eq(planPrices.planId, plusId))).length;
    const before = await countRows();

    const off = await send("PUT", path, {
      prices: [{ months: 12, currency: "EGP", amountMinor: null }],
      reason: "stop selling the annual plan",
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().diff.removed).toEqual([{ months: 12, currency: "EGP", amountMinor: 99_000 }]);
    expect(await countRows()).toBe(before);
    const [row] = await ctx.owner.db
      .select()
      .from(planPrices)
      .where(and(eq(planPrices.planId, plusId), eq(planPrices.months, 12)));
    expect(row).toMatchObject({ active: false, amountMinor: 99_000 });
    expect(priceOf(await plan("plus"), 12, "EGP")).toMatchObject({
      amountMinor: null,
      active: false,
    });

    const on = await send("PUT", path, {
      prices: [
        { months: 12, currency: "EGP", amountMinor: 99_000 },
        { months: 3, currency: "EGP", amountMinor: 27_000 },
      ],
      reason: "annual plan is back",
    });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json().diff).toMatchObject({
      changed: [{ months: 12, currency: "EGP", from: null, to: 99_000 }],
      added: [{ months: 3, currency: "EGP", amountMinor: 27_000 }],
    });
    expect(await countRows()).toBe(before + 1);
    expect(priceOf(await plan("plus"), 12, "EGP")?.active).toBe(true);
  });

  it("validates the body, needs fresh authentication and billing.write, and 404s an unknown plan", async () => {
    const plusId = await planIdOf(ctx, "plus");
    const path = `/admin/billing/plans/${plusId}/prices`;
    const cell = { months: 1, currency: "EGP", amountMinor: 9_900 };

    const bad: Array<Record<string, unknown>> = [
      { prices: [cell] },
      { prices: [cell], reason: "no" },
      { prices: [], reason: "nothing to publish" },
      { prices: [cell, cell], reason: "the same cell twice" },
      { prices: [{ ...cell, months: 25 }], reason: "too long a period" },
      { prices: [{ ...cell, currency: "egp" }], reason: "lower-case currency" },
      { prices: [{ ...cell, amountMinor: 0 }], reason: "a free price" },
      { prices: [{ ...cell, amountMinor: 9.5 }], reason: "a fractional price" },
    ];
    for (const body of bad) {
      expect((await send("PUT", path, body)).statusCode, JSON.stringify(body)).toBe(400);
    }

    const reauth = await send(
      "PUT",
      path,
      { prices: [cell], reason: "needs a fresh login" },
      stale,
    );
    expect(reauth.statusCode).toBe(401);
    expect(reauth.json()).toMatchObject({ details: { reason: "reauth" } });

    const reader = await ctx.admin(await ctx.customRole(["billing.read"]));
    expect(
      (await send("PUT", path, { prices: [cell], reason: "reader tries" }, reader)).statusCode,
    ).toBe(403);
    // The preview is a read.
    expect((await send("POST", `${path}/preview`, { prices: [cell] }, reader)).statusCode).toBe(
      201,
    );

    expect(
      (
        await send("PUT", `/admin/billing/plans/${MISSING_ID}/prices`, {
          prices: [cell],
          reason: "no such plan",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await send("POST", `/admin/billing/plans/${MISSING_ID}/prices/preview`, { prices: [cell] }))
        .statusCode,
    ).toBe(404);
    expect(priceOf(await plan("plus"), 1, "EGP")?.amountMinor).toBe(9_900);
    const [unchanged] = await ctx.owner.db.select().from(plans).where(eq(plans.id, plusId));
    expect(unchanged?.monthlyCredits).toBe(150);
  });
});

describe("credit packs", () => {
  interface PackView {
    id: string;
    key: string;
    credits: number;
    bonusCredits: number;
    validMonths: number;
    active: boolean;
    sort: number;
    prices: Array<{ currency: string; amountMinor: number | null }>;
  }
  const packs = async () => (await get("/admin/billing/credit-packs")).json().items as PackView[];
  let packId: string;
  const body = {
    key: "pack_extra",
    nameAr: "حزمة إضافية",
    nameEn: "Extra pack",
    credits: 500,
    validMonths: 6,
  };

  it("lists the seeded packs with their prices", async () => {
    const seeded = (await packs()).find((pack) => pack.key === "pack_100");
    expect(seeded).toMatchObject({
      credits: 100,
      bonusCredits: 0,
      active: true,
      prices: [{ currency: "EGP", amountMinor: 7_900 }],
    });
  });

  it("creates a pack with defaults, audits it and refuses a taken key", async () => {
    const created = await send("POST", "/admin/billing/credit-packs", body);
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      key: "pack_extra",
      credits: 500,
      bonusCredits: 0,
      validMonths: 6,
      active: true,
      prices: [],
    });
    packId = created.json().id;
    const audit = await ctx.auditRowsFor("credit_pack.created", packId);
    expect(audit[0]?.after).toMatchObject({ key: "pack_extra", credits: 500, active: true });

    const again = await send("POST", "/admin/billing/credit-packs", body);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ details: { reason: "key_taken" } });
  });

  it("validates a new pack", async () => {
    const bad: Array<Record<string, unknown>> = [
      { ...body, key: "Bad Key" },
      { ...body, key: "pack_zero", credits: 0 },
      { ...body, key: "pack_huge", credits: 1_000_001 },
      { ...body, key: "pack_bonus", bonusCredits: -1 },
      { ...body, key: "pack_bonus", bonusCredits: 1_000_001 },
      { ...body, key: "pack_months", validMonths: 0 },
      { ...body, key: "pack_months", validMonths: 37 },
      { ...body, key: "pack_name", nameEn: "" },
    ];
    for (const payload of bad) {
      expect(
        (await send("POST", "/admin/billing/credit-packs", payload)).statusCode,
        JSON.stringify(payload),
      ).toBe(400);
    }
    expect((await packs()).some((pack) => pack.key === "pack_zero")).toBe(false);
  });

  it("edits a pack but never its key, and records before and after", async () => {
    const response = await send("PATCH", `/admin/billing/credit-packs/${packId}`, {
      credits: 600,
      active: false,
      key: "pack_renamed",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ key: "pack_extra", credits: 600, active: false });
    const [row] = await ctx.owner.db.select().from(creditPacks).where(eq(creditPacks.id, packId));
    expect(row?.key).toBe("pack_extra");
    const audit = await ctx.auditRowsFor("credit_pack.updated", packId);
    expect(audit[0]?.before).toEqual({ credits: 500, active: true });
    expect(audit[0]?.after).toEqual({ credits: 600, active: false });

    expect((await send("PATCH", `/admin/billing/credit-packs/${packId}`, {})).statusCode).toBe(400);
    expect(
      (await send("PATCH", `/admin/billing/credit-packs/${packId}`, { credits: 0 })).statusCode,
    ).toBe(400);
    expect(
      (await send("PATCH", `/admin/billing/credit-packs/${MISSING_ID}`, { credits: 5 })).statusCode,
    ).toBe(404);
    // A pack is deactivated, never deleted.
    expect((await send("DELETE", `/admin/billing/credit-packs/${packId}`, {})).statusCode).toBe(
      404,
    );
  });

  it("sets prices per currency, switching one off with null", async () => {
    const path = `/admin/billing/credit-packs/${packId}/prices`;
    const set = await send("PUT", path, {
      reason: "launch prices",
      prices: [
        { currency: "EGP", amountMinor: 4_000 },
        { currency: "USD", amountMinor: 1_000 },
      ],
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().prices).toEqual([
      { currency: "EGP", amountMinor: 4_000 },
      { currency: "USD", amountMinor: 1_000 },
    ]);

    const off = await send("PUT", path, {
      reason: "no more dollars",
      prices: [{ currency: "USD", amountMinor: null }],
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().prices).toEqual([
      { currency: "EGP", amountMinor: 4_000 },
      { currency: "USD", amountMinor: null },
    ]);
    const rows = await ctx.owner.db
      .select()
      .from(creditPackPrices)
      .where(eq(creditPackPrices.packId, packId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.currency === "USD")).toMatchObject({
      active: false,
      amountMinor: 1_000,
    });

    const audit = await ctx.auditRowsFor("credit_pack.prices_updated", packId);
    expect(audit).toHaveLength(2);
    expect(audit[0]?.before).toEqual({
      prices: [
        { currency: "EGP", amountMinor: 4_000 },
        { currency: "USD", amountMinor: 1_000 },
      ],
    });
    expect(audit[0]?.after).toMatchObject({ reason: "no more dollars" });
  });

  it("needs a reason, fresh authentication and billing.write for prices", async () => {
    const path = `/admin/billing/credit-packs/${packId}/prices`;
    const prices = [{ currency: "EGP", amountMinor: 4_100 }];
    expect((await send("PUT", path, { prices })).statusCode).toBe(400);
    expect((await send("PUT", path, { prices, reason: "ab" })).statusCode).toBe(400);
    expect((await send("PUT", path, { prices: [], reason: "nothing at all" })).statusCode).toBe(
      400,
    );
    expect(
      (await send("PUT", path, { prices: [prices[0], prices[0]], reason: "duplicate currency" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await send("PUT", path, {
          prices: [{ currency: "EGP", amountMinor: 0 }],
          reason: "free pack",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await send("PUT", path, { prices, reason: "fresh login please" }, stale)).statusCode,
    ).toBe(401);
    const reader = await ctx.admin(await ctx.customRole(["billing.read"]));
    expect(
      (await send("PUT", path, { prices, reason: "reader tries it" }, reader)).statusCode,
    ).toBe(403);
    expect(
      (await send("POST", "/admin/billing/credit-packs", { ...body, key: "pack_reader" }, reader))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await send("PUT", `/admin/billing/credit-packs/${MISSING_ID}/prices`, {
          prices,
          reason: "no such pack",
        })
      ).statusCode,
    ).toBe(404);
    expect((await packs()).find((pack) => pack.id === packId)?.prices[0]?.amountMinor).toBe(4_000);
  });
});

describe("payment methods", () => {
  interface MethodView {
    key: string;
    kind: string;
    accountDisplay: string | null;
    pendingAccountChange: { id: string; effectiveAt: string } | null;
    feeBps: number;
    enabled: boolean;
    gateway: { enabled: boolean; verified: boolean } | null;
    [field: string]: unknown;
  }
  const methods = async () => (await get("/admin/billing/methods")).json().items as MethodView[];
  const method = async (key: string) => {
    const found = (await methods()).find((item) => item.key === key);
    if (!found) throw new Error(`method ${key} missing`);
    return found;
  };
  const rowOf = async (key: string) => {
    const [row] = await ctx.owner.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, key));
    if (!row) throw new Error(`method ${key} missing`);
    return row;
  };
  const patch = (key: string, payload: Record<string, unknown>, who: Who = boss) =>
    send("PATCH", `/admin/billing/methods/${key}`, payload, who);

  it("lists every method with its settings and the account shown masked", async () => {
    const response = await get("/admin/billing/methods");
    expect(response.statusCode).toBe(200);
    const instapay = await method("instapay");
    expect(instapay).toMatchObject({
      kind: "manual",
      provider: "instapay",
      nameEn: "InstaPay",
      accountDisplay: "********026",
      pendingAccountChange: null,
      feeBps: 0,
      feeFixedMinor: 0,
      currencies: ["EGP"],
      countries: null,
      requiresProof: true,
      reviewSlaMinutes: null,
      enabled: true,
      gateway: null,
    });
    expect(response.body).not.toContain("01014677026");
    expect(response.body).not.toContain("accountHolder");
    expect((await method("kashier_card")).kind).toBe("gateway");
  });

  it("shows a pending account change without revealing the new number", async () => {
    const row = await rowOf("vodafone_cash");
    const [change] = await ctx.owner.db
      .insert(paymentMethodAccountChanges)
      .values({
        methodId: row.id,
        oldAccountDisplay: "01014677026",
        newAccountDisplay: "01099990000",
        requestedBy: boss.userId,
        reason: "number moved",
        effectiveAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    const view = await method("vodafone_cash");
    expect(view.pendingAccountChange).toEqual({
      id: change?.id,
      effectiveAt: change?.effectiveAt.toISOString(),
    });
    expect(JSON.stringify(await methods())).not.toContain("01099990000");
  });

  it("changes the allowed fields, audits before and after, and ignores the account fields", async () => {
    const before = await rowOf("instapay");
    const response = await patch("instapay", {
      reason: "InstaPay raised its fee",
      nameEn: "InstaPay transfer",
      instructionsEn: "Send {amount} to {account} and write {reference}",
      feeBps: 150,
      feeFixedMinor: 200,
      minAmountMinor: 1_000,
      maxAmountMinor: 500_000,
      reviewSlaMinutes: 30,
      requiresProof: false,
      sort: 5,
      countries: ["EG"],
      // Not part of the schema: stripped, never written.
      accountDisplay: "01000000000",
      accountHolder: "Someone Else",
      config: { evil: true },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      key: "instapay",
      nameEn: "InstaPay transfer",
      feeBps: 150,
      feeFixedMinor: 200,
      minAmountMinor: 1_000,
      maxAmountMinor: 500_000,
      reviewSlaMinutes: 30,
      requiresProof: false,
      sort: 5,
      countries: ["EG"],
      accountDisplay: "********026",
    });

    const after = await rowOf("instapay");
    expect(after.accountDisplay).toBe(before.accountDisplay);
    expect(after.accountHolder).toBe(before.accountHolder);
    expect(after.config).toEqual(before.config);
    expect(after.enabled).toBe(true);

    const audit = await ctx.auditRowsFor("payment_method.updated", "instapay");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before).toMatchObject({ feeBps: 0, nameEn: "InstaPay", requiresProof: true });
    expect(audit[0]?.after).toMatchObject({
      feeBps: 150,
      nameEn: "InstaPay transfer",
      reason: "InstaPay raised its fee",
    });
    const recorded = JSON.stringify([audit[0]?.before, audit[0]?.after]);
    expect(recorded).not.toContain("accountDisplay");
    expect(recorded).not.toContain("01000000000");
    expect(recorded).not.toContain("Someone Else");

    // null clears an optional field.
    const cleared = await patch("instapay", {
      reason: "available everywhere again",
      countries: null,
      reviewSlaMinutes: null,
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({ countries: null, reviewSlaMinutes: null });
  });

  it("rejects values outside the limits", async () => {
    const reason = "checking the limits";
    const bad: Array<Record<string, unknown>> = [
      { feeBps: 2_001 },
      { feeBps: -1 },
      { feeFixedMinor: -1 },
      { reviewSlaMinutes: 4 },
      { reviewSlaMinutes: 1_441 },
      { currencies: [] },
      { currencies: ["egp"] },
      { instructionsEn: "x".repeat(2_001) },
      { instructionsEn: "Send {amount} to {wallet}" },
      { instructionsAr: "{" },
      { nameEn: "" },
      { countries: ["Egypt"] },
      { minAmountMinor: 9_000, maxAmountMinor: 1_000 },
      // Only the reason, nothing to change.
      {},
    ];
    for (const payload of bad) {
      const response = await patch("instapay", { reason, ...payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await patch("instapay", { feeBps: 10 })).statusCode).toBe(400);
    expect((await patch("instapay", { reason: "ab", feeBps: 10 })).statusCode).toBe(400);
    // The minimum is also checked against the stored maximum.
    const against = await patch("instapay", { reason, minAmountMinor: 600_000 });
    expect(against.statusCode, against.body).toBe(400);
    expect(against.json()).toMatchObject({ details: { fields: ["maxAmountMinor"] } });
    expect((await method("instapay")).feeBps).toBe(150);
  });

  it("answers 404 for an unknown method, 401 without a fresh login and 403 without billing.write", async () => {
    expect((await patch("no_such_method", { reason: "unknown one", feeBps: 1 })).statusCode).toBe(
      404,
    );
    const reauth = await patch("instapay", { reason: "fresh login please", feeBps: 1 }, stale);
    expect(reauth.statusCode).toBe(401);
    const reader = await ctx.admin(await ctx.customRole(["billing.read"]));
    expect(
      (await patch("instapay", { reason: "reader tries it", feeBps: 1 }, reader)).statusCode,
    ).toBe(403);
    expect((await method("instapay")).feeBps).toBe(150);
  });

  it("enables a gateway method only when its gateway is enabled and verified", async () => {
    const enable = { reason: "go live with cards", enabled: true };
    // No gateway at all.
    const missing = await patch("kashier_card", enable);
    expect(missing.statusCode, missing.body).toBe(409);
    expect(missing.json()).toMatchObject({ details: { reason: "gateway_unverified" } });

    await ctx.owner.db.insert(paymentGateways).values({
      key: "kashier",
      provider: "kashier",
      enabled: true,
      verifiedAt: null,
    });
    expect((await patch("kashier_card", enable)).statusCode).toBe(409);
    await ctx.owner.db
      .update(paymentGateways)
      .set({ enabled: false, verifiedAt: new Date() })
      .where(eq(paymentGateways.key, "kashier"));
    expect((await patch("kashier_card", enable)).statusCode).toBe(409);
    expect((await method("kashier_card")).enabled).toBe(false);
    expect((await method("kashier_card")).gateway).toEqual({ enabled: false, verified: true });

    await ctx.owner.db
      .update(paymentGateways)
      .set({ enabled: true })
      .where(eq(paymentGateways.key, "kashier"));
    const enabled = await patch("kashier_card", enable);
    expect(enabled.statusCode, enabled.body).toBe(200);
    expect(enabled.json()).toMatchObject({
      enabled: true,
      gateway: { enabled: true, verified: true },
    });

    // Turning a method off never needs the gateway.
    await ctx.owner.db
      .update(paymentGateways)
      .set({ enabled: false })
      .where(eq(paymentGateways.key, "kashier"));
    const disabled = await patch("kashier_card", { reason: "pause cards", enabled: false });
    expect(disabled.statusCode, disabled.body).toBe(200);
    expect(disabled.json()).toMatchObject({ enabled: false });
    await ctx.owner.db
      .update(paymentGateways)
      .set({ enabled: true })
      .where(eq(paymentGateways.key, "kashier"));
    expect((await patch("kashier_card", enable)).statusCode).toBe(200);
  });
});

describe("tax rules", () => {
  interface RuleView {
    id: string;
    country: string | null;
    rateBps: number;
    mode: string;
    appliesTo: string;
    active: boolean;
    nameEn: string;
  }
  const rules = async () => (await get("/admin/billing/tax-rules")).json() as RuleView[];
  const create = (payload: Record<string, unknown>, who: Who = boss) =>
    send("POST", "/admin/billing/tax-rules", payload, who);
  const patch = (id: string, payload: Record<string, unknown>, who: Who = boss) =>
    send("PATCH", `/admin/billing/tax-rules/${id}`, payload, who);
  const rule = {
    reason: "accountant confirmed the rate",
    nameAr: "ضريبة",
    nameEn: "Sales tax",
    mode: "added",
    appliesTo: "all",
  };
  const activeIn = async (country: string | null) =>
    (await rules()).filter((item) => item.active && item.country === country);
  let seededId: string;

  it("lists the seeded rule, switched off", async () => {
    const [seeded] = await rules();
    expect(seeded).toMatchObject({
      country: "EG",
      rateBps: 1_400,
      mode: "inclusive",
      appliesTo: "all",
      active: false,
    });
    seededId = seeded?.id ?? "";
  });

  it("allows one active rule per country and swaps them only on request", async () => {
    const first = await create({ ...rule, country: "EG", rateBps: 1_400, active: true });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ country: "EG", rateBps: 1_400, active: true });
    const firstId = first.json().id as string;

    const clash = await create({
      ...rule,
      nameEn: "Second",
      country: "EG",
      rateBps: 500,
      active: true,
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ details: { reason: "active_tax_rule_exists" } });
    expect(await activeIn("EG")).toHaveLength(1);

    const swapped = await create({
      ...rule,
      nameEn: "Second",
      country: "EG",
      rateBps: 500,
      active: true,
      replaceActive: true,
    });
    expect(swapped.statusCode, swapped.body).toBe(201);
    const active = await activeIn("EG");
    expect(active.map((item) => item.id)).toEqual([swapped.json().id]);
    expect((await rules()).find((item) => item.id === firstId)?.active).toBe(false);

    // Other countries and the default rule (no country) are independent.
    expect((await create({ ...rule, country: "AE", rateBps: 500, active: true })).statusCode).toBe(
      201,
    );
    expect((await create({ ...rule, country: null, rateBps: 300, active: true })).statusCode).toBe(
      201,
    );
    expect((await create({ ...rule, country: null, rateBps: 300, active: true })).statusCode).toBe(
      409,
    );
    // An inactive rule never clashes.
    expect((await create({ ...rule, country: "EG", rateBps: 100, active: false })).statusCode).toBe(
      201,
    );
    expect(await activeIn("EG")).toHaveLength(1);

    const created = await ctx.auditRowsFor("tax_rule.created", swapped.json().id);
    expect(created[0]?.after).toMatchObject({
      country: "EG",
      rateBps: 500,
      replaceActive: true,
      reason: "accountant confirmed the rate",
    });
  });

  it("edits a rule and keeps the one-active rule when activating or moving it", async () => {
    const eg = (await activeIn("EG"))[0];
    expect(eg).toBeDefined();
    const renamed = await patch(eg?.id ?? "", { reason: "rate correction", rateBps: 1_200 });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ rateBps: 1_200, active: true });
    const audit = await ctx.auditRowsFor("tax_rule.updated", eg?.id ?? "");
    expect(audit[0]?.before).toEqual({ rateBps: 500 });
    expect(audit[0]?.after).toMatchObject({ rateBps: 1_200, reason: "rate correction" });

    // Activating the seeded Egyptian rule while another is active: refused, then swapped.
    const blocked = await patch(seededId, { reason: "use the seeded rule", active: true });
    expect(blocked.statusCode).toBe(409);
    expect((await activeIn("EG"))[0]?.id).toBe(eg?.id);
    const swapped = await patch(seededId, {
      reason: "use the seeded rule",
      active: true,
      replaceActive: true,
    });
    expect(swapped.statusCode, swapped.body).toBe(200);
    expect((await activeIn("EG")).map((item) => item.id)).toEqual([seededId]);

    // Moving an active rule into a country that already has one is the same clash.
    const ae = (await activeIn("AE"))[0];
    const move = await patch(ae?.id ?? "", { reason: "wrong country", country: "EG" });
    expect(move.statusCode).toBe(409);
    expect((await activeIn("AE")).map((item) => item.id)).toEqual([ae?.id]);
    // Deactivating never clashes.
    expect(
      (await patch(ae?.id ?? "", { reason: "no longer taxed", active: false })).statusCode,
    ).toBe(200);
  });

  it("validates, needs fresh authentication and billing.write, and 404s an unknown rule", async () => {
    const valid = { ...rule, country: "SA", rateBps: 1_500, active: false };
    const bad: Array<Record<string, unknown>> = [
      { ...valid, reason: "ab" },
      { ...valid, rateBps: 10_001 },
      { ...valid, rateBps: -1 },
      { ...valid, mode: "included" },
      { ...valid, appliesTo: "everything" },
      { ...valid, country: "Egypt" },
      { ...valid, nameEn: "" },
    ];
    for (const payload of bad) {
      expect((await create(payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await create(valid, stale)).statusCode).toBe(401);
    const reader = await ctx.admin(await ctx.customRole(["billing.read"]));
    expect((await create(valid, reader)).statusCode).toBe(403);
    expect((await patch(seededId, { rateBps: 100 })).statusCode).toBe(400);
    expect((await patch(seededId, { reason: "only a reason" })).statusCode).toBe(400);
    expect((await patch(seededId, { reason: "bad rate", rateBps: 20_000 })).statusCode).toBe(400);
    expect((await patch(MISSING_ID, { reason: "no such rule", rateBps: 100 })).statusCode).toBe(
      404,
    );
    expect(
      (await patch(seededId, { reason: "fresh login please", rateBps: 100 }, stale)).statusCode,
    ).toBe(401);
    expect((await rules()).some((item) => item.country === "SA")).toBe(false);
  });

  it("feeds the active tax rule and the worst enabled fee into the margin", async () => {
    // Inclusive 14% VAT (the seeded rule is active) and InstaPay's 1.5%: 9,900 piasters become
    // 9,900 - 1,216 = 8,684 before the fee and 8,554 after it; the 7,500 cost leaves 1,054.
    const active = await ctx.owner.db.select().from(taxRules).where(eq(taxRules.active, true));
    expect(active.find((item) => item.country === "EG")).toMatchObject({
      mode: "inclusive",
      rateBps: 1_400,
    });
    const plusId = await planIdOf(ctx, "plus");
    const preview = await send("POST", `/admin/billing/plans/${plusId}/prices/preview`, {
      prices: [{ months: 1, currency: "EGP", amountMinor: 9_900 }],
    });
    expect(preview.statusCode, preview.body).toBe(201);
    expect(preview.json().margin[0].margin).toMatchObject({
      revenueMonthlyMinor: 8_554,
      costFullMinor: 7_500,
      marginFullMinor: 1_054,
    });
  });
});
