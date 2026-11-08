import "server-only";

import {
  adClickResponseSchema,
  adSlotResponseSchema,
  canServeOnClass,
  type AdDevice,
  type AdSlotView,
  type PageClass,
} from "@wasfa/shared/ads";
import { cache } from "react";

import { serverEnv } from "./server-env";
import { serverApi } from "./session";

/*
 * Server-side ad reads (docs/ADS.md §4.3). Slots are chosen by the API; this only asks for one and
 * remembers what the page already shows. Every failure means "no ad": a slot never breaks a page.
 */

export const AD_SLOT_REVALIDATE_SECONDS = 60;
const AD_TIMEOUT_MS = 1_500;

/** What this render already shows, so the next slot respects density and one-advertiser-per-page. */
const shownOnPage = cache((): { placement: string; creativeId: string }[] => []);

export interface AdSlotRequest {
  placement: string;
  pageClass: PageClass;
  locale?: "ar" | "en" | undefined;
  /** Only known when the caller already reads request headers; unset = device targeting is skipped. */
  device?: AdDevice | undefined;
  country?: string | undefined;
}

/** The ad for a slot, or `null` (floor class, switch off, nothing eligible, API unreachable). */
export async function getAdSlot(request: AdSlotRequest): Promise<AdSlotView | null> {
  // Belt and braces: the API refuses these classes too, but a call should not even be made.
  if (!canServeOnClass(request.pageClass)) return null;

  const already = shownOnPage();
  const query = new URLSearchParams({
    placement: request.placement,
    pageClass: request.pageClass,
  });
  if (request.locale) query.set("locale", request.locale);
  if (request.device) query.set("device", request.device);
  if (request.country) query.set("country", request.country);
  if (already.length > 0) {
    query.set("already", already.map((ad) => `${ad.placement}:${ad.creativeId}`).join(","));
  }
  const path = `/public/ads/slot?${query.toString()}`;

  try {
    const slot =
      request.pageClass === "app_neutral"
        ? // App pages: forward the session so the API can honour the ad-free plan. Uncached, per user.
          (await serverApi(path, { schema: adSlotResponseSchema })).slot
        : await fetchShared(path);
    if (slot) already.push({ placement: slot.placement, creativeId: slot.creativeId });
    return slot;
  } catch {
    return null;
  }
}

/** Public pages: no cookie, shared by every visitor for a minute (Next's data cache). */
async function fetchShared(path: string): Promise<AdSlotView | null> {
  const response = await fetch(`${serverEnv.API_INTERNAL_URL}${path}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: AD_SLOT_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(AD_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const parsed = adSlotResponseSchema.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data.slot : null;
}

/**
 * Counts a click for the signed token and returns the creative's own https destination, or `null`.
 * The client IP is forwarded so the API's per-IP limit does not count every visitor as this server.
 */
export async function resolveAdClick(
  token: string,
  clientHeaders: { cfConnectingIp: string | null; forwardedFor: string | null },
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (clientHeaders.cfConnectingIp) headers["CF-Connecting-IP"] = clientHeaders.cfConnectingIp;
  if (clientHeaders.forwardedFor) headers["X-Forwarded-For"] = clientHeaders.forwardedFor;
  try {
    const response = await fetch(`${serverEnv.API_INTERNAL_URL}/public/ads/click`, {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(AD_TIMEOUT_MS * 2),
    });
    if (!response.ok) return null;
    const parsed = adClickResponseSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data.url : null;
  } catch {
    return null;
  }
}

/** Batched impression tokens to the API; the response is never needed. */
export async function forwardAdImpressions(
  tokens: readonly string[],
  clientHeaders: { cfConnectingIp: string | null; forwardedFor: string | null },
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (clientHeaders.cfConnectingIp) headers["CF-Connecting-IP"] = clientHeaders.cfConnectingIp;
  if (clientHeaders.forwardedFor) headers["X-Forwarded-For"] = clientHeaders.forwardedFor;
  try {
    await fetch(`${serverEnv.API_INTERNAL_URL}/public/ads/impressions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tokens }),
      cache: "no-store",
      signal: AbortSignal.timeout(AD_TIMEOUT_MS * 2),
    });
  } catch {
    // An impression that cannot be counted is dropped, never retried or surfaced.
  }
}
