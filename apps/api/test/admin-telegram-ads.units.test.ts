import {
  telegramAdCampaignInputSchema,
  telegramAdCreativeInputSchema,
  telegramAdStatsSchema,
  telegramAdsSettingsInputSchema,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import { SETTINGS_REGISTRY, isSettingKey } from "@wasfa/shared/settings";
import { describe, expect, it, vi } from "vitest";

import { AdminTelegramAdsService } from "../src/admin/telegram/admin-telegram-ads.service.js";
import { patchSchemaOf } from "../src/admin/telegram/telegram-ads-patch.js";

const CAMPAIGN = "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a20";

describe("admin contract round trips", () => {
  it("registers telegramAds as an admin setting with sane, adjustable defaults (no limit on weekly or global totals)", () => {
    expect(isSettingKey("telegramAds")).toBe(true);
    expect(SETTINGS_REGISTRY.telegramAds.visibility).toBe("admin");
    const defaults = telegramAdsSettingsInputSchema.parse({});
    expect(defaults.enabled).toBe(true);
    for (const key of ["probability", "maxPerChatPerDay", "minGapMinutes"] as const) {
      expect(defaults[key].enabled).toBe(true);
    }
    for (const key of ["maxPerChatPerWeek", "globalDailyLimit"] as const) {
      expect(defaults[key].enabled).toBe(false);
    }
    expect(defaults.quietHours.enabled).toBe(false);
  });

  it("round-trips a campaign and a creative through their create schemas", () => {
    const campaign = telegramAdCampaignInputSchema.parse({ name: "  Ramadan " });
    expect(campaign).toMatchObject({ name: "Ramadan", status: "draft", dailyImpressionCap: null });
    const creative = telegramAdCreativeInputSchema.parse({
      campaignId: CAMPAIGN,
      name: "c",
      headline: "h",
      buttons: [{ label: "Go", url: "https://shop.example" }],
    });
    expect(creative).toMatchObject({ layout: "hero", buttonsPerRow: 1, weight: 100 });
    expect(
      telegramAdCreativeInputSchema.safeParse({
        campaignId: CAMPAIGN,
        name: "c",
        headline: "h",
        buttons: [{ label: "x", url: "http://plain.example" }],
      }).success,
    ).toBe(false);
  });

  it("a PATCH keeps the fields it does not mention (no defaults filled in)", () => {
    const patch = patchSchemaOf(telegramAdCampaignInputSchema).parse({ name: "x" });
    expect(patch).toEqual({ name: "x" });
    const creativePatch = patchSchemaOf(telegramAdCreativeInputSchema).parse({ weight: 5 });
    expect(creativePatch).toEqual({ weight: 5 });
    expect(patchSchemaOf(telegramAdCreativeInputSchema).safeParse({ weight: 0 }).success).toBe(
      false,
    );
  });

  it("validates the stats response shape", () => {
    const zero = {
      impressions: 0,
      clicks: 0,
      reactions: 0,
      hides: 0,
      reach: 0,
      ctr: 0,
      engagementRate: 0,
    };
    expect(
      telegramAdStatsSchema.safeParse({
        from: "2026-11-01",
        to: "2026-11-09",
        totals: zero,
        byDay: [{ day: "2026-11-01", ...zero }],
        byCampaign: [],
        byCreative: [],
        byTrigger: [{ trigger: "after_rx_done", ...zero }],
      }).success,
    ).toBe(true);
  });
});

describe("AdminTelegramAdsService stats", () => {
  const counts = (impressions: number, clicks = 0, reactions = 0) => ({
    impressions,
    clicks,
    reactions,
    hides: 0,
    reach: impressions,
  });
  function build(rows = {}) {
    const repo = {
      stats: vi.fn(async () => ({
        totals: counts(100, 5, 15),
        byDay: [{ day: "2026-11-09", ...counts(0, 0, 0) }],
        byCampaign: [],
        byCreative: [],
        byTrigger: [
          { trigger: "after_rx_done", ...counts(10, 1) },
          { trigger: "weird", ...counts(1) },
        ],
        ...rows,
      })),
      statsByDayCreative: vi.fn(async () => [
        {
          day: "2026-11-09",
          creativeId: "c",
          name: "=cmd",
          campaign: "Camp, Inc",
          ...counts(4, 1, 1),
        },
      ]),
    };
    const service = new AdminTelegramAdsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, repo };
  }
  const query = { from: "2026-11-01", to: "2026-11-09" };

  it("computes ctr and engagement, zero when a day has no impressions, drops unknown triggers", async () => {
    const stats = await build().service.stats(query);
    expect(stats.totals.ctr).toBeCloseTo(0.05);
    expect(stats.totals.engagementRate).toBeCloseTo(0.2);
    expect(stats.byDay[0]?.ctr).toBe(0);
    expect(stats.byTrigger.map((row) => row.trigger)).toEqual(["after_rx_done"]);
    expect(telegramAdStatsSchema.safeParse(stats).success).toBe(true);
  });

  it("refuses an inverted or oversized range", async () => {
    const { service } = build();
    await expect(service.stats({ from: "2026-11-09", to: "2026-11-01" })).rejects.toThrow();
    await expect(service.stats({ from: "2024-01-01", to: "2026-11-01" })).rejects.toThrow();
  });

  it("exports one CSV row per day and creative, defusing formulas and quoting commas", async () => {
    const lines = await build().service.statsCsv(query);
    expect(lines[0]).toContain("day,campaign,creative,impressions");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('2026-11-09,"Camp, Inc",\'=cmd,4,1,1,0,4,0.2500,0.5000\r\n');
  });
});
