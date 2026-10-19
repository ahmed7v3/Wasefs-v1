import { publicEnv } from "../../lib/env";
import { SITEMAP_HEADERS, buildUrlset, pageSitemapUrls } from "../../lib/sitemap-xml";

export function GET(): Response {
  return new Response(buildUrlset(pageSitemapUrls(publicEnv.NEXT_PUBLIC_SITE_URL)), {
    headers: SITEMAP_HEADERS,
  });
}
