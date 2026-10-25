import { contentIndexChildren } from "../../lib/content-sitemaps";
import { publicEnv } from "../../lib/env";
import { SITEMAP_HEADERS, sitemapIndexFor } from "../../lib/sitemap-xml";

/**
 * The last index that was built with the API reachable. A blip of the API must not turn the sitemap
 * into an error Search Console reports, and a silently SHORTER index would hide content children, so
 * an outage serves this copy (short cache) and only a cold start without one answers 500 (retried).
 */
let lastGood: string | null = null;

// Reads the content API on every request (its fetches carry cache tags): never prerendered at build time.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const siteUrl = publicEnv.NEXT_PUBLIC_SITE_URL;
  try {
    lastGood = sitemapIndexFor(siteUrl, await contentIndexChildren(siteUrl));
    return new Response(lastGood, { headers: SITEMAP_HEADERS });
  } catch (error) {
    if (lastGood === null) throw error;
    return new Response(lastGood, {
      headers: { ...SITEMAP_HEADERS, "Cache-Control": "public, max-age=300" },
    });
  }
}
