import { AI_CRAWLERS, type PublicSettings } from "@wasfa/shared/settings";

import type { MetadataRoute } from "next";

/*
 * robots.txt policy (SEO-GEO §5.3), pure so it is unit-tested per setting. The same prefixes drive
 * the `X-Robots-Tag: noindex, nofollow` header `proxy.ts` puts on the private and auth pages.
 */

/** Exactly the SEO-GEO §5.3 list. */
export const DISALLOWED_PATHS = [
  "/admin",
  "/api/",
  "/dashboard",
  "/analyze",
  "/ai",
  "/account",
  "/billing",
  "/checkout",
  "/rewards",
  "/org",
  "/capture",
  "/drugs/search",
] as const;

/** Path of the IndexNow key file route; the worker sender passes it as `keyLocation`. */
export const INDEXNOW_KEY_PATH = "/indexnow.txt";

/** Trees that must never be indexed even when reached: app, admin, API and the `(auth)` pages. */
const NOINDEX_PREFIXES = [
  "/admin",
  "/api",
  "/capture",
  "/dashboard",
  "/onboarding",
  "/account",
  "/analyze",
  "/ai",
  "/checkout",
  "/billing",
  "/org",
  "/rewards",
  "/taste",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/join",
] as const;

export function isNoindexPath(pathname: string): boolean {
  return NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

type SeoCrawlerPolicy = Pick<PublicSettings["seo"], "aiCrawlers">;

export function robotsRules(
  seo: SeoCrawlerPolicy,
  siteUrl: string,
  production: boolean,
): MetadataRoute.Robots {
  if (!production) {
    // Staging, previews and local runs must never end up in a search index.
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  // Allowed bots need no group: the `*` group already lets them in.
  const blocked = AI_CRAWLERS.filter((bot) => seo.aiCrawlers[bot] === false).map((bot) => ({
    userAgent: bot,
    disallow: "/",
  }));
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] }, ...blocked],
    sitemap: new URL("/sitemap.xml", siteUrl).toString(),
  };
}
