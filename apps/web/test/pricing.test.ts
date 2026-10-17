import { settingDefault, type PublicSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { comparisonModel } from "../src/lib/pricing-compare";
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

describe("comparisonModel", () => {
  it("has a free column, one per plan, and a row per distinct feature", () => {
    const feature = (textAr: string, included: boolean) => ({
      textAr,
      textEn: textAr,
      included,
      highlight: false,
    });
    const model = comparisonModel(
      [
        plan("plus", { features: [feature("بحث ويب", false), feature("دعم", true)] }),
        plan("pro", { trialDays: 7, features: [feature("بحث ويب", true)] }),
      ],
      3,
    );
    expect(model.columns.map((column) => column.key)).toEqual(["free", "plus", "pro"]);
    const web = model.rows.find((row) => row.key === "feature-بحث ويب");
    expect(web?.cells).toEqual([null, false, true]);
    const support = model.rows.find((row) => row.key === "feature-دعم");
    expect(support?.cells).toEqual([null, true, false]);
    expect(model.rows.find((row) => row.key === "trial")?.cells).toEqual([null, false, "7 يومًا"]);
  });
});
