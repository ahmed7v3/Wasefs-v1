import { describe, expect, it } from "vitest";

import {
  AD_PLACEMENT_CATALOG,
  FORBIDDEN_CATEGORIES,
  NEVER_SERVE_CLASSES,
  PAGE_CLASSES,
  adsSettingsSchema,
  canServeOnClass,
  createCreativeSchema,
  maxAdsForClass,
  updatePlacementSchema,
} from "../src/ads.js";
import { settingDefault } from "../src/settings.js";

describe("ads safety floor", () => {
  it("fixes the never-serve classes and forbidden categories in code", () => {
    expect(NEVER_SERVE_CLASSES).toEqual(["conversion", "app_sensitive"]);
    expect(FORBIDDEN_CATEGORIES).toEqual(["medicine"]);
    expect(PAGE_CLASSES.filter(canServeOnClass)).toEqual([
      "marketing",
      "content",
      "medical_reference",
      "utility_public",
      "app_neutral",
    ]);
  });

  it("never lets an admin assign a placement to a floor class", () => {
    expect(updatePlacementSchema.safeParse({ pageClasses: ["conversion"] }).success).toBe(false);
    expect(updatePlacementSchema.safeParse({ pageClasses: ["app_sensitive"] }).success).toBe(false);
    expect(updatePlacementSchema.safeParse({ pageClasses: ["content"] }).success).toBe(true);
  });

  it("keeps the catalog on servable classes with unique keys", () => {
    const keys = AD_PLACEMENT_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of AD_PLACEMENT_CATALOG) expect(canServeOnClass(entry.pageClass)).toBe(true);
    expect(keys).toEqual(
      expect.arrayContaining([
        "global.bottom_banner",
        "home.after_hero",
        "home.mid",
        "home.before_faq",
      ]),
    );
    const banner = AD_PLACEMENT_CATALOG.find((entry) => entry.key === "global.bottom_banner");
    expect(banner).toMatchObject({ closable: true, dismissDays: 7 });
  });
});

describe("ads settings", () => {
  it("is registered, off by default and caps the floor classes at zero", () => {
    const settings = settingDefault("ads");
    expect(settings).toEqual(adsSettingsSchema.parse({}));
    expect(settings.enabled).toBe(false);
    expect(settings.whatsapp).toMatchObject({
      enabled: false,
      probability: 0.7,
      maxPerUserPerDay: 2,
      minGapHours: 6,
      globalDailyLimit: 300,
      allowOptOut: true,
      quietHours: { from: "23:00", to: "08:00", timezone: "Africa/Cairo" },
    });
    expect(maxAdsForClass(settings, "marketing")).toBe(1);
    expect(maxAdsForClass({ ...settings, maxPerPage: { conversion: 5 } }, "conversion")).toBe(0);
    expect(maxAdsForClass({ ...settings, maxPerPage: { app_sensitive: 5 } }, "app_sensitive")).toBe(
      0,
    );
  });

  it("rejects a floor class in the banner selection", () => {
    expect(
      adsSettingsSchema.safeParse({ bottomBanner: { pageClasses: ["app_sensitive"] } }).success,
    ).toBe(false);
  });
});

describe("creative input", () => {
  const base = {
    title: "Offer",
    alt: "Offer",
    targetUrl: "https://example.com/offer",
    category: "house",
  };

  it("defaults to a web house creative and requires https", () => {
    const parsed = createCreativeSchema.parse(base);
    expect(parsed).toMatchObject({ advertiserId: null, channels: ["web"], weight: 100 });
    expect(
      createCreativeSchema.safeParse({ ...base, targetUrl: "http://example.com" }).success,
    ).toBe(false);
    expect(
      createCreativeSchema.safeParse({ ...base, targetUrl: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("orders the schedule and bounds the WhatsApp text", () => {
    const window = { startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" };
    expect(createCreativeSchema.safeParse({ ...base, ...window }).success).toBe(false);
    expect(createCreativeSchema.safeParse({ ...base, waText: "x".repeat(701) }).success).toBe(
      false,
    );
    expect(
      createCreativeSchema.safeParse({
        ...base,
        waText: "x".repeat(700),
        channels: ["web", "whatsapp"],
      }).success,
    ).toBe(true);
  });
});
