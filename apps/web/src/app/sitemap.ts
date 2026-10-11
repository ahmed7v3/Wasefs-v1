import { publicEnv } from "../lib/env";
import { sitemapEntries } from "../lib/seo";

import type { MetadataRoute } from "next";

/** Blog, city and drug pages join the table in `lib/seo.ts` when they exist (SEO-GEO.md). */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(publicEnv.NEXT_PUBLIC_SITE_URL);
}
