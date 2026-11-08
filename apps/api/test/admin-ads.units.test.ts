import {
  adsSettingsSchema,
  createCreativeSchema,
  updateAdvertiserSchema,
  updateCreativeSchema,
  type AdsSettings,
} from "@wasfa/shared/ads";
import { isAppError } from "@wasfa/shared/errors";
import { describe, expect, it, vi } from "vitest";

import { AdminAdsService } from "../src/ads/admin-ads.service.js";
import { aggregateAdStats, type AdStatsRow } from "../src/ads/ads-stats.js";

import type { AdminAdsRepo, CreativeAdminRow } from "../src/ads/admin-ads.repo.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { AdCreativeRow, AdPlacementRow } from "@wasfa/db";

const NOW = new Date("2026-11-08T12:00:00Z");
const CREATIVE_ID = "11111111-1111-4111-8111-111111111111";

const placement = (patch: Partial<AdPlacementRow> = {}): AdPlacementRow => ({
  key: "home.mid",
  enabled: false,
  pageClasses: ["marketing"],
  devices: ["mobile", "tablet", "desktop"],
  maxPerPage: 1,
  format: "banner",
  sizeDesktop: "970x250",
  sizeMobile: "320x100",
  closable: false,
  dismissDays: 7,
  allowPaid: true,
  sort: 20,
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

const creative = (patch: Partial<AdCreativeRow> = {}): CreativeAdminRow => ({
  creative: {
    id: CREATIVE_ID,
    advertiserId: null,
    title: "Offer",
    imageMediaId: null,
    alt: "Offer",
    targetUrl: "https://example.com",
    category: "house",
    status: "draft",
    startsAt: null,
    endsAt: null,
    weight: 100,
    targeting: { placements: [], pageClasses: [], devices: [], locales: [], countries: [] },
    channels: ["web"],
    waText: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  },
  advertiserName: null,
  media: null,
});

function build(
  options: { placement?: AdPlacementRow; creative?: CreativeAdminRow; stats?: AdStatsRow[] } = {},
) {
  const settings = adsSettingsSchema.parse({ enabled: true });
  const repo = {
    placement: vi.fn(async () => options.placement ?? placement()),
    updatePlacement: vi.fn(async (_key: string, patch: Partial<AdPlacementRow>) => ({
      ...(options.placement ?? placement()),
      ...patch,
    })),
    creative: vi.fn(async () => options.creative ?? creative()),
    updateCreative: vi.fn(async () => true),
    statsRows: vi.fn(async () => options.stats ?? []),
  };
  const settingsService = {
    get: vi.fn(async () => settings),
    set: vi.fn(async (_key: string, value: AdsSettings) => value),
  };
  const service = new AdminAdsService(
    repo as unknown as AdminAdsRepo,
    settingsService as unknown as SettingsService,
    { MEDIA_PUBLIC_ORIGIN: undefined },
  );
  return { service, repo, settingsService };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return isAppError(error) ? error.code : "OTHER";
  }
  return undefined;
}

describe("placement update and the floor", () => {
  it("refuses a never-serve class with a typed error and writes nothing", async () => {
    const { service, repo } = build();
    for (const pageClass of ["conversion", "app_sensitive"] as const) {
      expect(
        await codeOf(
          service.updatePlacement(
            "home.mid",
            { pageClasses: [pageClass] },
            {},
            {
              actorId: "a",
            },
          ),
        ),
      ).toBe("AD_CLASS_NOT_SERVABLE");
    }
    expect(repo.updatePlacement).not.toHaveBeenCalled();
  });

  it("refuses a list that hides a floor class among servable ones", async () => {
    const { service } = build();
    expect(
      await codeOf(
        service.updatePlacement(
          "home.mid",
          { pageClasses: ["marketing", "conversion"] },
          {},
          {
            actorId: "a",
          },
        ),
      ),
    ).toBe("AD_CLASS_NOT_SERVABLE");
  });

  it("saves a servable change and records before and after", async () => {
    const { service, repo } = build();
    const audit: { before?: unknown; after?: unknown; targetId?: string } = {};
    const view = await service.updatePlacement(
      "home.mid",
      { enabled: true, pageClasses: ["marketing", "content"], maxPerPage: 2 },
      audit,
      { actorId: "a" },
    );
    expect(repo.updatePlacement).toHaveBeenCalledWith(
      "home.mid",
      expect.objectContaining({
        enabled: true,
        maxPerPage: 2,
        pageClasses: ["marketing", "content"],
      }),
    );
    expect(view).toMatchObject({ enabled: true, maxPerPage: 2 });
    expect(audit.targetId).toBe("home.mid");
    expect(audit.before).toMatchObject({ enabled: false });
    expect(audit.after).toMatchObject({ enabled: true });
  });

  it("does not expose or edit the WhatsApp counters as placements", async () => {
    const { service } = build();
    expect(
      await codeOf(
        service.updatePlacement("whatsapp.after_rx_done", { enabled: true }, {}, { actorId: "a" }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("keeps the bottom banner switch, classes and dismiss period in the ads setting", async () => {
    const { service, settingsService, repo } = build({
      placement: placement({ key: "global.bottom_banner", format: "bottom_banner" }),
    });
    await service.updatePlacement(
      "global.bottom_banner",
      { enabled: true, pageClasses: ["marketing"], dismissDays: 14 },
      {},
      { actorId: "a" },
    );
    expect(settingsService.set).toHaveBeenCalledWith(
      "ads",
      expect.objectContaining({
        bottomBanner: { enabled: true, pageClasses: ["marketing"], dismissDays: 14 },
      }),
      { actorId: "a" },
    );
    // Only the row's own switch is written there; classes and days never reach the table.
    expect(repo.updatePlacement).toHaveBeenCalledWith("global.bottom_banner", { enabled: true });
  });
});

describe("creative approval", () => {
  it("refuses to approve the medicine category, with the typed error", async () => {
    const { service, repo } = build({ creative: creative({ category: "medicine" }) });
    expect(await codeOf(service.setCreativeStatus(CREATIVE_ID, "approved", {}))).toBe(
      "AD_CATEGORY_FORBIDDEN",
    );
    expect(repo.updateCreative).not.toHaveBeenCalled();
  });

  it("approves any other category and may pause or archive a medicine draft", async () => {
    const ok = build({ creative: creative({ category: "pharmacy_delivery" }) });
    await ok.service.setCreativeStatus(CREATIVE_ID, "approved", {});
    expect(ok.repo.updateCreative).toHaveBeenCalledWith(CREATIVE_ID, { status: "approved" });

    const medicine = build({ creative: creative({ category: "medicine" }) });
    await medicine.service.setCreativeStatus(CREATIVE_ID, "archived", {});
    expect(medicine.repo.updateCreative).toHaveBeenCalledWith(CREATIVE_ID, { status: "archived" });
  });

  it("does not let an edit turn an approved creative into a medicine", async () => {
    const { service, repo } = build({ creative: creative({ status: "approved" }) });
    expect(await codeOf(service.updateCreative(CREATIVE_ID, { category: "medicine" }, {}))).toBe(
      "AD_CATEGORY_FORBIDDEN",
    );
    expect(repo.updateCreative).not.toHaveBeenCalled();
  });

  it("needs the WhatsApp text before a creative can use the WhatsApp channel", async () => {
    const { service } = build();
    expect(
      await codeOf(service.updateCreative(CREATIVE_ID, { channels: ["web", "whatsapp"] }, {})),
    ).toBe("VALIDATION_FAILED");
  });
});

describe("creative input schemas", () => {
  const base = {
    title: "Offer",
    alt: "Offer",
    targetUrl: "https://example.com/offer",
    category: "house",
  };

  it("accepts only https target URLs", () => {
    expect(createCreativeSchema.safeParse(base).success).toBe(true);
    for (const targetUrl of [
      "http://example.com",
      "javascript:alert(1)",
      "ftp://example.com",
      "//example.com",
      "https://exa mple.com",
    ]) {
      expect(createCreativeSchema.safeParse({ ...base, targetUrl }).success, targetUrl).toBe(false);
    }
    expect(updateCreativeSchema.safeParse({ targetUrl: "http://example.com" }).success).toBe(false);
  });

  it("caps the WhatsApp text at 700 characters", () => {
    expect(createCreativeSchema.safeParse({ ...base, waText: "x".repeat(700) }).success).toBe(true);
    expect(createCreativeSchema.safeParse({ ...base, waText: "x".repeat(701) }).success).toBe(
      false,
    );
  });

  it("an update only carries the fields that were sent (no default resets weight, channels or targeting)", () => {
    expect(updateCreativeSchema.parse({ title: "New" })).toEqual({ title: "New" });
    expect(updateAdvertiserSchema.parse({ name: "Acme" })).toEqual({ name: "Acme" });
    expect(updateCreativeSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an end before the start", () => {
    expect(
      createCreativeSchema.safeParse({
        ...base,
        startsAt: "2026-12-01T00:00:00Z",
        endsAt: "2026-11-01T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});

describe("ad statistics", () => {
  const rows: AdStatsRow[] = [
    {
      creativeId: "a",
      title: "A",
      placementKey: "home.mid",
      day: "2026-11-07",
      channel: "web",
      impressions: 100,
      clicks: 5,
    },
    {
      creativeId: "a",
      title: "A",
      placementKey: "home.mid",
      day: "2026-11-08",
      channel: "web",
      impressions: 300,
      clicks: 9,
    },
    {
      creativeId: "b",
      title: "B",
      placementKey: "blog.feed",
      day: "2026-11-08",
      channel: "web",
      impressions: 100,
      clicks: 0,
    },
    {
      creativeId: "b",
      title: "B",
      placementKey: "whatsapp.after_rx_done",
      day: "2026-11-08",
      channel: "whatsapp",
      impressions: 50,
      clicks: 5,
    },
  ];
  const range = { from: "2026-11-02", to: "2026-11-08", channel: null } as const;

  it("sums totals and computes CTR per group", () => {
    const stats = aggregateAdStats(rows, range);
    expect(stats.totals).toEqual({ impressions: 550, clicks: 19, ctr: 19 / 550 });
    expect(stats.byDay).toEqual([
      { day: "2026-11-07", impressions: 100, clicks: 5, ctr: 0.05 },
      { day: "2026-11-08", impressions: 450, clicks: 14, ctr: 14 / 450 },
    ]);
    expect(stats.byPlacement.map((row) => row.placement)).toEqual([
      "blog.feed",
      "home.mid",
      "whatsapp.after_rx_done",
    ]);
    expect(stats.byCreative[0]).toMatchObject({
      creativeId: "a",
      title: "A",
      impressions: 400,
      clicks: 14,
    });
    expect(stats.byChannel).toEqual([
      { channel: "web", impressions: 500, clicks: 14, ctr: 14 / 500 },
      { channel: "whatsapp", impressions: 50, clicks: 5, ctr: 0.1 },
    ]);
  });

  it("gives a CTR of 0, not NaN, when there is no impression", () => {
    const stats = aggregateAdStats([], range);
    expect(stats.totals).toEqual({ impressions: 0, clicks: 0, ctr: 0 });
    expect(stats.byDay).toEqual([]);
  });

  it("defaults to the last 7 days and refuses a reversed or over-long range", async () => {
    const { service, repo } = build({ stats: rows });
    const stats = await service.stats({}, NOW);
    expect(repo.statsRows).toHaveBeenCalledWith({
      from: "2026-11-02",
      to: "2026-11-08",
      channel: null,
    });
    expect(stats.from).toBe("2026-11-02");
    expect(await codeOf(service.stats({ from: "2026-11-08", to: "2026-11-01" }, NOW))).toBe(
      "VALIDATION_FAILED",
    );
    expect(await codeOf(service.stats({ from: "2024-01-01", to: "2026-11-08" }, NOW))).toBe(
      "VALIDATION_FAILED",
    );
  });
});
