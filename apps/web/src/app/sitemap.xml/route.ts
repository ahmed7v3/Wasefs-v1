import { publicEnv } from "../../lib/env";
import { SITEMAP_HEADERS, sitemapIndexFor } from "../../lib/sitemap-xml";

export function GET(): Response {
  return new Response(sitemapIndexFor(publicEnv.NEXT_PUBLIC_SITE_URL), { headers: SITEMAP_HEADERS });
}
