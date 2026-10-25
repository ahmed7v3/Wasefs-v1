import { contentSitemapUrls } from "../../lib/content-sitemaps";
import { publicEnv } from "../../lib/env";
import { SITEMAP_HEADERS, buildUrlset } from "../../lib/sitemap-xml";

// Reads the content API on every request (its fetches carry cache tags): never prerendered at build time.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const urls = await contentSitemapUrls("glossary", publicEnv.NEXT_PUBLIC_SITE_URL);
  return new Response(buildUrlset(urls), { headers: SITEMAP_HEADERS });
}
