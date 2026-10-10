import { publicEnv } from "../lib/env";

import type { MetadataRoute } from "next";

/** Stub: Phase 1 adds the landing pages, then blog, city and drug pages (SEO-GEO.md). */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: new URL("/", publicEnv.NEXT_PUBLIC_SITE_URL).toString(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
