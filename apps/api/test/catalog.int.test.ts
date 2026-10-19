import { coupons, planPrices, plans, promotions, taxRules } from "@wasfa/db";
import { catalogResponseSchema, type CatalogResponse } from "@wasfa/shared/schemas/billing";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CATALOG_INVALIDATION_TOPIC } from "../src/catalog/catalog.service.js";
import { InvalidationBus } from "../src/common/invalidation-bus.js";

import { AdminTestContext } from "./support/admin-context.js";
import { expectRateLimited } from "./support/identity-fixtures.js";

/*
 * GET /catalog against a real Postgres 18. The seeded paid plans are hidden, so setup publishes
 * plus and pro (the seeds already carry their EGP prices) and adds a SAR price for plus only.
 * The catalog is cached per currency and country for a minute, so a test that changes data uses a
 * country of its own.
 */

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
  const { db } = ctx.owner;
  await db
    .update(plans)
    .set({ visibility: "public" })
    .where(inArray(plans.key, ["plus", "pro"]));
  const [plus] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, "plus"));
  if (!plus) throw new Error("plus is not seeded");
  await db.insert(planPrices).values([
    { planId: plus.id, months: 1, currency: "SAR", amountMinor: 4_900 },
    { planId: plus.id, months: 12, currency: "SAR", amountMinor: 49_000 },
  ]);
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function getCatalog(
  url = "/catalog",
  headers: Record<string, string> = {},
): Promise<{ body: CatalogResponse; raw: string; headers: Record<string, unknown> }> {
  const res = await ctx.harness.call("GET", url, { headers });
  expect(res.statusCode, res.body).toBe(200);
  return { body: catalogResponseSchema.parse(res.json()), raw: res.body, headers: res.headers };
}

const keys = (catalog: CatalogResponse) => catalog.plans.map((plan) => plan.key);

describe("GET /catalog", () => {
  it("serves the default currency (EGP) to an anonymous visitor", async () => {
    const { body } = await getCatalog();
    expect(body.currency).toBe("EGP");
    expect(body.country).toBeNull();
    expect(keys(body)).toEqual(["plus", "pro"]);
    const plus = body.plans.find((plan) => plan.key === "plus");
    expect(plus?.prices.map((price) => [price.months, price.amountMinor])).toEqual([
      [1, 9_900],
      [12, 99_000],
    ]);
    // Pay 10, get 12: 12 x 99.00 - 990.00.
    expect(plus?.annualSavingsMinor).toBe(19_800);
    expect(plus?.prices[1]?.display).toMatchObject({ headlineMinor: 99_000, struckMinor: null });
    expect(body.tax).toEqual({ mode: "none" });
    expect(body.creditPacks.map((pack) => pack.key)).toEqual(["pack_100", "pack_300", "pack_1000"]);
    expect(body.methods.map((method) => method.key)).toEqual(["instapay", "vodafone_cash"]);
    expect(body.methods.every((method) => method.feeFree)).toBe(true);
    expect(body.billing).toMatchObject({ trialAvailable: true });
  });

  it("lists only plans that have an active price in the currency", async () => {
    const { body } = await getCatalog("/catalog?currency=SAR");
    expect(body.currency).toBe("SAR");
    // pro has no SAR price, clinic is hidden, free has no price at all.
    expect(keys(body)).toEqual(["plus"]);
    expect(body.plans[0]?.prices[0]?.amountMinor).toBe(4_900);
    expect(body.methods).toEqual([]);
  });

  it("falls back to the default for a currency that is unknown or not enabled", async () => {
    expect((await getCatalog("/catalog?currency=XYZ")).body.currency).toBe("EGP");
    expect((await getCatalog("/catalog?currency=sar%20")).body.currency).toBe("SAR");
    expect((await getCatalog("/catalog?currency=zz!")).body.currency).toBe("EGP");
  });

  it("follows CF-IPCountry when no currency is asked for, and ?currency= wins over it", async () => {
    const sa = await getCatalog("/catalog", { "cf-ipcountry": "SA" });
    expect(sa.body.currency).toBe("SAR");
    expect(sa.body.country).toBe("SA");
    expect((await getCatalog("/catalog", { "cf-ipcountry": "XX" })).body.currency).toBe("EGP");
    expect((await getCatalog("/catalog", { "cf-ipcountry": "DE" })).body.currency).toBe("EGP");
    const override = await getCatalog("/catalog?currency=EGP", { "cf-ipcountry": "SA" });
    expect(override.body.currency).toBe("EGP");
  });

  it("is cacheable per country and says so", async () => {
    const { headers } = await getCatalog();
    expect(headers["cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(String(headers["vary"]).toLowerCase()).toContain("cf-ipcountry");
  });

  it("contains no coupon, deal, account number or instruction text", async () => {
    await ctx.owner.db.insert(coupons).values({
      code: "SECRET-CODE-10",
      kind: "percent",
      name: "Private coupon",
      titleAr: "خاص",
      titleEn: "Private",
      value: 1_000,
      status: "active",
    });
    const { raw } = await getCatalog("/catalog?country=FR");
    for (const forbidden of [
      "SECRET-CODE-10",
      "01014677026",
      "account",
      "instructions",
      "coupon",
      "deal",
      "holder",
    ]) {
      expect(raw.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it("shows a pricing promotion as a struck price, and a countdown only when it opts in", async () => {
    const { db } = ctx.owner;
    const [plus] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, "plus"));
    const [pro] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, "pro"));
    if (!plus || !pro) throw new Error("plans are not seeded");
    const endsAt = new Date(Date.now() + 3 * 86_400_000);
    const base = {
      kind: "percent" as const,
      status: "active" as const,
      showOnPricing: true,
      endsAt,
    };
    const [countdown] = await db
      .insert(promotions)
      .values({
        ...base,
        name: "Plus launch",
        titleAr: "إطلاق بلس",
        titleEn: "Plus launch",
        badgeAr: "-20%",
        badgeEn: "-20%",
        value: 2_000,
        planIds: [plus.id],
        showCountdown: true,
      })
      .returning({ id: promotions.id });
    const [quiet] = await db
      .insert(promotions)
      .values({
        ...base,
        name: "Pro quiet",
        titleAr: "خصم برو",
        titleEn: "Pro offer",
        value: 1_000,
        planIds: [pro.id],
        showCountdown: false,
      })
      .returning({ id: promotions.id });
    // A hidden promotion (not shown on pricing) still prices, but is not listed.
    await db.insert(promotions).values({
      ...base,
      name: "Unlisted",
      titleAr: "غير معلن",
      titleEn: "Unlisted",
      value: 100,
      planIds: [pro.id],
      showOnPricing: false,
    });

    const { body } = await getCatalog("/catalog?country=EG");
    const plusPrice = body.plans.find((plan) => plan.key === "plus")?.prices[0];
    expect(plusPrice).toMatchObject({
      amountMinor: 9_900,
      promotionId: countdown?.id,
      display: { struckMinor: 9_900, headlineMinor: 7_920, savingsMinor: 1_980 },
    });
    const listed = Object.fromEntries(body.promotions.map((promo) => [promo.id, promo]));
    expect(body.promotions).toHaveLength(2);
    expect(listed[countdown?.id ?? ""]?.endsAt).toBe(endsAt.toISOString());
    expect(listed[quiet?.id ?? ""]?.endsAt).toBeNull();
    expect(listed[quiet?.id ?? ""]?.badge).toBeNull();
  });

  it("reports the tax mode of the active rule for the country, else the default rule", async () => {
    await ctx.owner.db.insert(taxRules).values({
      country: "BE",
      nameAr: "ضريبة",
      nameEn: "VAT",
      rateBps: 1_900,
      mode: "added",
      active: true,
    });
    await ctx.owner.db.insert(taxRules).values({
      country: null,
      nameAr: "ضريبة",
      nameEn: "Default VAT",
      rateBps: 500,
      mode: "inclusive",
      active: true,
    });
    expect((await getCatalog("/catalog?country=BE")).body.tax).toEqual({ mode: "added" });
    expect((await getCatalog("/catalog?country=NL")).body.tax).toEqual({ mode: "inclusive" });
    // The price on the page never carries tax (BILLING 6.1).
    const de = (await getCatalog("/catalog?country=BE")).body;
    const price = de.plans[0]?.prices[0];
    expect((price?.display.headlineMinor ?? 0) + (price?.display.savingsMinor ?? 0)).toBe(
      price?.amountMinor,
    );
  });

  it("offers a public plan only inside its sale window", async () => {
    const { db } = ctx.owner;
    const hour = 60 * 60 * 1000;
    const window = async (availableFrom: Date | null, availableUntil: Date | null) => {
      await db.update(plans).set({ availableFrom, availableUntil }).where(eq(plans.key, "plus"));
    };
    try {
      // Each check uses a country of its own: the catalog is cached per country.
      await window(new Date(Date.now() + hour), null);
      expect(keys((await getCatalog("/catalog?country=KW")).body)).toEqual(["pro"]);
      await window(new Date(Date.now() - 2 * hour), new Date(Date.now() - hour));
      expect(keys((await getCatalog("/catalog?country=QA")).body)).toEqual(["pro"]);
      await window(new Date(Date.now() - hour), new Date(Date.now() + hour));
      expect(keys((await getCatalog("/catalog?country=BH")).body)).toEqual(["plus", "pro"]);
    } finally {
      await window(null, null);
    }
  });

  it("shows the default currency's plans when no plan is priced in the asked one", async () => {
    const { db } = ctx.owner;
    await db.update(planPrices).set({ active: false }).where(eq(planPrices.currency, "SAR"));
    try {
      // A country of its own: the catalog is cached per currency and country.
      const { body } = await getCatalog("/catalog?currency=SAR&country=OM");
      expect(body.currency).toBe("EGP");
      expect(keys(body)).toEqual(["plus", "pro"]);
    } finally {
      await db.update(planPrices).set({ active: true }).where(eq(planPrices.currency, "SAR"));
    }
  });

  it("drops its cache when the catalog topic is published", async () => {
    const { db } = ctx.owner;
    const [pro] = await db.select({ id: plans.id }).from(plans).where(eq(plans.key, "pro"));
    if (!pro) throw new Error("pro is not seeded");
    const url = "/catalog?country=AE";
    const before = await getCatalog(url);
    const listed = before.body.promotions.length;

    await db.insert(promotions).values({
      name: "Late promo",
      kind: "percent",
      titleAr: "متأخر",
      titleEn: "Late",
      value: 3_000,
      status: "active",
      showOnPricing: true,
      planIds: [pro.id],
    });
    // Still cached.
    expect((await getCatalog(url)).body.promotions).toHaveLength(listed);

    await ctx.app.get(InvalidationBus).publish(CATALOG_INVALIDATION_TOPIC, "test");
    const deadline = Date.now() + 5_000;
    let after = await getCatalog(url);
    while (after.body.promotions.length === listed && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      after = await getCatalog(url);
    }
    expect(after.body.promotions).toHaveLength(listed + 1);
  });

  it("is limited to 120 requests a minute", async () => {
    await expectRateLimited(ctx.harness, { method: "GET", url: "/catalog", max: 120 });
  });
});
