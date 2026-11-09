import {
  AD_DEVICES,
  canServeOnClass,
  isForbiddenCategory,
  maxAdsForClass,
  type AdDevice,
  type AdsSettings,
  type PageClass,
} from "@wasfa/shared/ads";

import type { AdCreativeRow, AdPlacementRow } from "@wasfa/db";

const BOTTOM_BANNER_KEY = "global.bottom_banner";

/*
 * The deterministic part of ad delivery: given a placement, the candidate creatives and the page
 * context, which creative (if any) may be served. Pure and synchronous, so every rule of the safety
 * floor (docs/ADS.md §1) is unit-tested without a database. The context carries NO user profile,
 * prescription, analysis or chat signal: only page class, device, locale, country and whether the
 * plan is ad-free.
 */

export interface AdOnPage {
  placement: string;
  creativeId: string;
  /** Null = a house creative. */
  advertiserId: string | null;
}

export interface AdContext {
  pageClass: PageClass;
  device?: AdDevice | undefined;
  locale?: string | undefined;
  country?: string | undefined;
  userEntitlements: { adsFree: boolean };
  alreadyOnPage: readonly AdOnPage[];
}

export interface Candidate {
  creative: AdCreativeRow;
  advertiserActive: boolean;
}

export type Rng = () => number;

/** The page classes a placement serves: the admin's banner selection for the bottom banner, else its own. */
export function placementClasses(
  placement: Pick<AdPlacementRow, "format" | "pageClasses">,
  settings: AdsSettings,
): readonly PageClass[] {
  if (placement.format === "bottom_banner") {
    return settings.bottomBanner.enabled ? settings.bottomBanner.pageClasses : [];
  }
  return placement.pageClasses;
}

/** Placement-level gates: switches, the class floor, device and density. No creative is looked at. */
export function placementServes(
  placement: AdPlacementRow,
  settings: AdsSettings,
  ctx: AdContext,
): boolean {
  if (!settings.enabled || !placement.enabled) return false;
  // The floor is code: whatever the admin set, these classes never serve.
  if (!canServeOnClass(ctx.pageClass)) return false;
  if (!placementClasses(placement, settings).includes(ctx.pageClass)) return false;
  if (ctx.device !== undefined && !placement.devices.includes(ctx.device)) return false;
  if (ctx.userEntitlements.adsFree) return false;

  const sameSlot = ctx.alreadyOnPage.filter((ad) => ad.placement === placement.key).length;
  if (sameSlot >= placement.maxPerPage) return false;
  // The fixed bottom banner overlays no content, so it does not use up the page's density: neither
  // when it is the one asking, nor when it was already placed on the page (the layout and the page
  // fetch their slots in parallel, so it can land first).
  const inPage = ctx.alreadyOnPage.filter((ad) => ad.placement !== BOTTOM_BANNER_KEY).length;
  if (placement.format !== "bottom_banner" && inPage >= maxAdsForClass(settings, ctx.pageClass)) {
    return false;
  }
  return true;
}

function inWindow(creative: AdCreativeRow, now: Date): boolean {
  if (creative.startsAt && creative.startsAt.getTime() > now.getTime()) return false;
  if (creative.endsAt && creative.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

/** An empty targeting list means "any"; a non-empty list needs a known matching value. */
function matches(list: readonly string[] | undefined, value: string | undefined): boolean {
  if (!list || list.length === 0) return true;
  return value !== undefined && list.includes(value);
}

export function eligibleCreatives(
  placement: AdPlacementRow,
  candidates: readonly Candidate[],
  ctx: AdContext,
  now: Date,
): AdCreativeRow[] {
  const advertisersOnPage = new Set(
    ctx.alreadyOnPage.flatMap((ad) => (ad.advertiserId === null ? [] : [ad.advertiserId])),
  );
  const creativesOnPage = new Set(ctx.alreadyOnPage.map((ad) => ad.creativeId));

  return candidates
    .filter(({ creative, advertiserActive }) => {
      if (creative.status !== "approved" || isForbiddenCategory(creative.category)) return false;
      if (!creative.channels.includes("web")) return false;
      if (creative.advertiserId !== null && !advertiserActive) return false;
      if (creative.advertiserId !== null && !placement.allowPaid) return false;
      if (!inWindow(creative, now)) return false;
      const targeting = creative.targeting;
      if (!matches(targeting.placements, placement.key)) return false;
      if (!matches(targeting.pageClasses, ctx.pageClass)) return false;
      // A list naming every device is "any device": it must not block a request that does not say.
      const allDevices = (targeting.devices?.length ?? 0) >= AD_DEVICES.length;
      if (!allDevices && !matches(targeting.devices, ctx.device)) return false;
      if (!matches(targeting.locales, ctx.locale)) return false;
      if (!matches(targeting.countries, ctx.country)) return false;
      // One advertiser once per page; a house creative is deduped by itself.
      if (
        creative.advertiserId === null
          ? creativesOnPage.has(creative.id)
          : advertisersOnPage.has(creative.advertiserId)
      ) {
        return false;
      }
      return true;
    })
    .map(({ creative }) => creative);
}

/** Weighted random: a creative of weight 300 is served three times as often as one of weight 100. */
export function weightedPick(creatives: readonly AdCreativeRow[], rng: Rng): AdCreativeRow | null {
  const total = creatives.reduce((sum, creative) => sum + creative.weight, 0);
  if (creatives.length === 0 || total <= 0) return null;
  let cursor = rng() * total;
  for (const creative of creatives) {
    cursor -= creative.weight;
    if (cursor < 0) return creative;
  }
  return creatives[creatives.length - 1] ?? null;
}

export function selectCreative(input: {
  placement: AdPlacementRow;
  candidates: readonly Candidate[];
  settings: AdsSettings;
  ctx: AdContext;
  now: Date;
  rng: Rng;
}): AdCreativeRow | null {
  const { placement, candidates, settings, ctx, now, rng } = input;
  if (!placementServes(placement, settings, ctx)) return null;
  return weightedPick(eligibleCreatives(placement, candidates, ctx, now), rng);
}

/**
 * WhatsApp ads: approved, non-medicine, scheduled creatives of the WhatsApp channel that have a
 * message text. Nothing else is looked at: no placement, page, locale, country or user signal, and
 * the function cannot receive any message, prescription or analysis content.
 */
export function eligibleWhatsAppCreatives(
  candidates: readonly Candidate[],
  now: Date,
): AdCreativeRow[] {
  return candidates
    .filter(({ creative, advertiserActive }) => {
      if (creative.status !== "approved" || isForbiddenCategory(creative.category)) return false;
      if (!creative.channels.includes("whatsapp")) return false;
      if (creative.waText === null || creative.waText.trim() === "") return false;
      if (creative.advertiserId !== null && !advertiserActive) return false;
      return inWindow(creative, now);
    })
    .map(({ creative }) => creative);
}

export function selectWhatsAppCreative(
  candidates: readonly Candidate[],
  now: Date,
  rng: Rng,
): AdCreativeRow | null {
  return weightedPick(eligibleWhatsAppCreatives(candidates, now), rng);
}
