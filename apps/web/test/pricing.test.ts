import { settingDefault, type PublicSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { comparisonModel } from "../src/lib/pricing-compare";
import {
  bestSavingsPercent,
  defaultDuration,
  durationLabel,
  offeredDurations,
  planOffer,
} from "../src/lib/pricing-durations";
import { productJsonLd } from "../src/lib/structured-data";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";

const settings: PublicSettings = {
  branding: settingDefault("branding"),
  contact: settingDefault("contact"),
  socials: settingDefault("socials"),
  locale: settingDefault("locale"),
  currency: settingDefault("currency"),
  access: settingDefault("access"),
  free_tier: settingDefault("free_tier"),
  rx: settingDefault("rx"),
  seo: settingDefault("seo"),
};

function plan(
  key: string,
  extra: Partial<CatalogResponse["plans"][number]> = {},
): CatalogResponse["plans"][number] {
  return {
    key,
    audience: "individual",
    names: { ar: key === "plus" ? "بلس" : "برو", en: key },
    tagline: null,
    features: [],
    badge: null,
    pinRecommended: false,
    trialDays: 0,
    monthlyCredits: 150,
    maxMembers: null,
    fairUseNote: null,
    prices: [],
    ...extra,
  };
}

describe("productJsonLd", () => {
  it("lists one Offer per plan price with exact decimal prices", () => {
    const data = productJsonLd(settings, "https://wasfa.online", {
      name: "اشتراكات",
      description: "وصف",
      offers: [
        { name: "بلس - شهر واحد", amountMinor: 9_900, currency: "EGP" },
        { name: "بلس - سنة كاملة", amountMinor: 99_000, currency: "EGP" },
      ],
    });
    expect(data["@type"]).toBe("Product");
    const offers = data["offers"] as { price: string; priceCurrency: string; url: string }[];
    expect(offers.map((offer) => offer.price)).toEqual(["99.00", "990.00"]);
    expect(offers[0]).toMatchObject({ priceCurrency: "EGP", url: "https://wasfa.online/pricing" });
  });
});

const feature = (textAr: string, included: boolean) => ({
  textAr,
  textEn: textAr,
  included,
  highlight: false,
});

const free = {
  key: "free",
  names: { ar: "المجانية", en: "Free" },
  tagline: null,
  features: [feature("دعم", true)],
  badge: null,
  monthlyCredits: 30,
};

describe("comparisonModel", () => {
  it("has the admin's free plan first, one column per plan, and a row per distinct feature", () => {
    const model = comparisonModel(
      [
        plan("plus", { features: [feature("بحث ويب", false), feature("دعم", true)] }),
        plan("pro", { trialDays: 7, features: [feature("بحث ويب", true)] }),
      ],
      free,
    );
    expect(model.columns.map((column) => column.key)).toEqual(["free", "plus", "pro"]);
    expect(model.rows.find((row) => row.key === "credits")?.cells[0]).toBe("30 كريدت شهريًا");
    const web = model.rows.find((row) => row.key === "feature-بحث ويب");
    expect(web?.cells).toEqual([false, false, true]);
    const support = model.rows.find((row) => row.key === "feature-دعم");
    expect(support?.cells).toEqual([true, true, false]);
    expect(model.rows.find((row) => row.key === "trial")?.cells).toEqual([null, false, "7 يومًا"]);
  });

  it("uses the English names, texts and labels for the English page", () => {
    const model = comparisonModel(
      [plan("plus", { features: [{ ...feature("دعم", true), textEn: "Support" }] })],
      null,
      "en",
    );
    expect(model.columns[0]?.name).toBe("plus");
    expect(model.rows.find((row) => row.key === "feature-دعم")?.label).toBe("Support");
    expect(model.rows.find((row) => row.key === "credits")?.cells[0]).toMatch(/^150 /);
  });

  it("leaves the free column out when the free plan is hidden, and the trial row when no plan has one", () => {
    const model = comparisonModel([plan("plus")], null);
    expect(model.columns.map((column) => column.key)).toEqual(["plus"]);
    expect(model.rows.find((row) => row.key === "trial")).toBeUndefined();
    expect(model.rows.every((row) => row.cells.length === 1)).toBe(true);
  });
});

const price = (months: number, amountMinor: number) => ({
  months,
  amountMinor,
  promotionId: null,
  display: {
    headlineMinor: amountMinor,
    struckMinor: null,
    savingsMinor: 0,
    perMonthMinor: Math.floor(amountMinor / months),
  },
});

describe("pricing durations", () => {
  const plus = plan("plus", { prices: [price(1, 2_000), price(3, 5_400), price(12, 10_000)] });
  const pro = plan("pro", { prices: [price(1, 5_000), price(6, 27_000)] });

  it("offers every priced period of any plan, and opens on a year when there is one", () => {
    expect(offeredDurations([plus, pro])).toEqual([1, 3, 6, 12]);
    expect(defaultDuration([1, 3, 6, 12])).toBe(12);
    expect(defaultDuration([1, 3])).toBe(1);
    expect(defaultDuration([3, 6])).toBe(3);
    expect(defaultDuration([])).toBeNull();
  });

  it("shows the effective monthly price and the saving against monthly", () => {
    const year = planOffer(plus, 12);
    expect(year?.exact).toBe(true);
    // 100.00 a year = 8.33 a month, 58% less than 20.00 a month.
    expect(year?.price.display.perMonthMinor).toBe(833);
    expect(year?.price.display.headlineMinor).toBe(10_000);
    expect(year?.savingsPercent).toBe(58);
    expect(planOffer(plus, 1)?.savingsPercent).toBe(0);
    expect(bestSavingsPercent([plus, pro], 6)).toBe(10);
  });

  it("falls back to a plan's closest period when it is not sold for the chosen one", () => {
    const offer = planOffer(pro, 12);
    expect(offer?.exact).toBe(false);
    expect(offer?.price.months).toBe(6);
    expect(planOffer(plan("empty"), 1)).toBeNull();
  });

  it("names the periods", () => {
    expect(durationLabel(1)).toBe("شهري");
    expect(durationLabel(12)).toBe("سنوي");
    expect(durationLabel(3)).toBe("3 أشهر");
  });
});
