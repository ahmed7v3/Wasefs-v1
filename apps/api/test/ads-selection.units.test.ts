import { adsSettingsSchema, type AdsSettings, type PageClass } from "@wasfa/shared/ads";
import { describe, expect, it } from "vitest";

import {
  eligibleCreatives,
  selectCreative,
  weightedPick,
  type AdContext,
  type Candidate,
} from "../src/ads/ads-selection.js";

import type { AdCreativeRow, AdPlacementRow } from "@wasfa/db";

const NOW = new Date("2026-11-08T12:00:00Z");

const settings = (patch: Partial<AdsSettings> = {}): AdsSettings => ({
  ...adsSettingsSchema.parse({ enabled: true }),
  ...patch,
});

const placement = (patch: Partial<AdPlacementRow> = {}): AdPlacementRow => ({
  key: "home.mid",
  enabled: true,
  pageClasses: ["marketing"],
  devices: ["mobile", "tablet", "desktop"],
  maxPerPage: 1,
  format: "banner",
  sizeDesktop: "970x250",
  sizeMobile: "320x100",
  closable: false,
  dismissDays: 7,
  allowPaid: true,
  sort: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

let counter = 0;
const creative = (patch: Partial<AdCreativeRow> = {}): AdCreativeRow => {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    advertiserId: null,
    title: "Offer",
    imageMediaId: null,
    alt: "Offer",
    targetUrl: "https://example.com",
    category: "house",
    status: "approved",
    startsAt: null,
    endsAt: null,
    weight: 100,
    targeting: { placements: [], pageClasses: [], devices: [], locales: [], countries: [] },
    channels: ["web"],
    waText: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
};

const candidate = (patch: Partial<AdCreativeRow> = {}, advertiserActive = true): Candidate => ({
  creative: creative(patch),
  advertiserActive,
});

const context = (patch: Partial<AdContext> = {}): AdContext => ({
  pageClass: "marketing",
  device: "desktop",
  locale: "ar",
  country: "EG",
  userEntitlements: { adsFree: false },
  alreadyOnPage: [],
  ...patch,
});

const select = (
  input: {
    placement?: AdPlacementRow;
    candidates?: Candidate[];
    settings?: AdsSettings;
    ctx?: AdContext;
    rng?: () => number;
  } = {},
) =>
  selectCreative({
    placement: input.placement ?? placement(),
    candidates: input.candidates ?? [candidate()],
    settings: input.settings ?? settings(),
    ctx: input.ctx ?? context(),
    now: NOW,
    rng: input.rng ?? (() => 0),
  });

describe("ad selection: switches", () => {
  it("serves an eligible creative", () => {
    expect(select()).not.toBeNull();
  });

  it("serves nothing when the global switch is off", () => {
    expect(select({ settings: settings({ enabled: false }) })).toBeNull();
  });

  it("serves nothing when the placement is off", () => {
    expect(select({ placement: placement({ enabled: false }) })).toBeNull();
  });

  it("serves nothing when the placement does not serve the page class", () => {
    expect(select({ ctx: context({ pageClass: "content" }) })).toBeNull();
  });
});

describe("ad selection: the safety floor", () => {
  const FLOOR: PageClass[] = ["conversion", "app_sensitive"];

  it.each(FLOOR)("never serves on %s even when the admin enables it everywhere", (pageClass) => {
    const everywhere = placement({
      pageClasses: ["marketing", "conversion", "content", "app_neutral", "app_sensitive"],
    });
    expect(select({ placement: everywhere, ctx: context({ pageClass }) })).toBeNull();
  });

  it("never serves a medicine creative, even one stored as approved", () => {
    expect(select({ candidates: [candidate({ category: "medicine" })] })).toBeNull();
  });

  it("does not serve drafts, paused or archived creatives", () => {
    const candidates = (["draft", "paused", "archived"] as const).map((status) =>
      candidate({ status }),
    );
    expect(select({ candidates })).toBeNull();
  });

  it("serves nothing to a user on an ad-free plan", () => {
    expect(select({ ctx: context({ userEntitlements: { adsFree: true } }) })).toBeNull();
  });

  it("does not serve a WhatsApp-only creative on the web", () => {
    expect(select({ candidates: [candidate({ channels: ["whatsapp"] })] })).toBeNull();
  });
});

describe("ad selection: schedule", () => {
  it("skips a creative that has not started", () => {
    const future = candidate({ startsAt: new Date("2026-11-09T00:00:00Z") });
    expect(select({ candidates: [future] })).toBeNull();
  });

  it("stops serving at the end date without any admin action", () => {
    const ended = candidate({ endsAt: new Date("2026-11-08T12:00:00Z") });
    expect(select({ candidates: [ended] })).toBeNull();
    const running = candidate({ endsAt: new Date("2026-11-08T12:00:01Z") });
    expect(select({ candidates: [running] })).not.toBeNull();
  });
});

describe("ad selection: targeting", () => {
  const targeted = (targeting: Partial<AdCreativeRow["targeting"]>) =>
    candidate({
      targeting: {
        placements: [],
        pageClasses: [],
        devices: [],
        locales: [],
        countries: [],
        ...targeting,
      },
    });

  it("treats an empty list as any", () => {
    expect(select({ candidates: [targeted({})] })).not.toBeNull();
  });

  it.each([
    ["placements", { placements: ["home.after_hero"] }],
    ["pageClasses", { pageClasses: ["content" as const] }],
    ["devices", { devices: ["mobile" as const] }],
    ["locales", { locales: ["en" as const] }],
    ["countries", { countries: ["SA"] }],
  ])("skips a creative whose %s targeting does not match", (_name, targeting) => {
    expect(select({ candidates: [targeted(targeting)] })).toBeNull();
  });

  it("serves a creative whose targeting matches every dimension", () => {
    const match = targeted({
      placements: ["home.mid"],
      pageClasses: ["marketing"],
      devices: ["desktop"],
      locales: ["ar"],
      countries: ["EG"],
    });
    expect(select({ candidates: [match] })).not.toBeNull();
  });

  it("skips a device- or country-targeted creative when the request does not say", () => {
    const ctx = context({ device: undefined, country: undefined });
    expect(select({ candidates: [targeted({ devices: ["desktop"] })], ctx })).toBeNull();
    expect(select({ candidates: [targeted({ countries: ["EG"] })], ctx })).toBeNull();
  });

  it("respects the placement's own device list", () => {
    const desktopOnly = placement({ devices: ["desktop"] });
    expect(select({ placement: desktopOnly, ctx: context({ device: "mobile" }) })).toBeNull();
    expect(select({ placement: desktopOnly, ctx: context({ device: "desktop" }) })).not.toBeNull();
  });

  it("keeps paid advertisers out of a house-only placement and inactive advertisers out everywhere", () => {
    const paid = candidate({ advertiserId: "00000000-0000-4000-8000-0000000000aa" });
    expect(select({ placement: placement({ allowPaid: false }), candidates: [paid] })).toBeNull();
    const inactive = candidate({ advertiserId: "00000000-0000-4000-8000-0000000000ab" }, false);
    expect(select({ candidates: [inactive] })).toBeNull();
  });
});

describe("ad selection: density and dedupe", () => {
  it("honors the per-class cap from settings", () => {
    const capped = settings({ maxPerPage: { marketing: 1 } });
    const ctx = context({
      alreadyOnPage: [{ placement: "home.after_hero", creativeId: "x", advertiserId: null }],
    });
    expect(select({ settings: capped, ctx })).toBeNull();
    const roomy = settings({ maxPerPage: { marketing: 2 } });
    expect(select({ settings: roomy, ctx })).not.toBeNull();
  });

  it("falls back to the default cap when the class is not configured", () => {
    const defaults = settings({ maxPerPage: {} });
    const ctx = context({
      alreadyOnPage: [{ placement: "home.after_hero", creativeId: "x", advertiserId: null }],
    });
    expect(select({ settings: defaults, ctx })).toBeNull();
  });

  it("honors the placement's own per-page cap", () => {
    const roomy = settings({ maxPerPage: { marketing: 5 } });
    const ctx = context({
      alreadyOnPage: [{ placement: "home.mid", creativeId: "x", advertiserId: null }],
    });
    expect(select({ settings: roomy, ctx })).toBeNull();
  });

  it("does not count the fixed bottom banner against the page density", () => {
    const banner = placement({ key: "global.bottom_banner", format: "bottom_banner" });
    const withBanner = settings({
      bottomBanner: { enabled: true, pageClasses: ["marketing"], dismissDays: 7 },
    });
    const ctx = context({
      alreadyOnPage: [{ placement: "home.mid", creativeId: "x", advertiserId: null }],
    });
    expect(select({ placement: banner, settings: withBanner, ctx })).not.toBeNull();
  });

  it("serves the bottom banner only on the classes the admin selected", () => {
    const banner = placement({ key: "global.bottom_banner", format: "bottom_banner" });
    const off = settings();
    expect(select({ placement: banner, settings: off })).toBeNull();
    const onContentOnly = settings({
      bottomBanner: { enabled: true, pageClasses: ["content"], dismissDays: 7 },
    });
    expect(select({ placement: banner, settings: onContentOnly })).toBeNull();
  });

  it("never shows two ads of the same advertiser on a page", () => {
    const advertiserId = "00000000-0000-4000-8000-0000000000cc";
    const same = candidate({ advertiserId });
    const other = candidate({ advertiserId: "00000000-0000-4000-8000-0000000000dd" });
    const ctx = context({
      alreadyOnPage: [{ placement: "home.after_hero", creativeId: "x", advertiserId }],
    });
    const roomy = settings({ maxPerPage: { marketing: 3 } });
    const eligible = eligibleCreatives(placement(), [same, other], ctx, NOW);
    expect(eligible).toEqual([other.creative]);
    expect(select({ settings: roomy, candidates: [same], ctx })).toBeNull();
  });

  it("does not repeat the same house creative on a page", () => {
    const house = candidate();
    const ctx = context({
      alreadyOnPage: [
        { placement: "home.after_hero", creativeId: house.creative.id, advertiserId: null },
      ],
    });
    expect(eligibleCreatives(placement(), [house], ctx, NOW)).toEqual([]);
  });
});

describe("ad selection: weighted random", () => {
  const a = creative({ weight: 100 });
  const b = creative({ weight: 300 });

  it("maps the draw onto the cumulative weights", () => {
    expect(weightedPick([a, b], () => 0)).toBe(a);
    expect(weightedPick([a, b], () => 0.2)).toBe(a);
    expect(weightedPick([a, b], () => 0.26)).toBe(b);
    expect(weightedPick([a, b], () => 0.999)).toBe(b);
  });

  it("serves in proportion to the weights with a seeded generator", () => {
    // A small LCG: deterministic, so the proportions are a stable assertion, not a flaky one.
    let seed = 42;
    const rng = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    const counts = new Map<string, number>();
    for (let i = 0; i < 4_000; i += 1) {
      const picked = weightedPick([a, b], rng);
      if (picked) counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
    }
    const share = (counts.get(b.id) ?? 0) / 4_000;
    expect(share).toBeGreaterThan(0.72);
    expect(share).toBeLessThan(0.78);
  });

  it("returns null for an empty list", () => {
    expect(weightedPick([], () => 0.5)).toBeNull();
  });
});
