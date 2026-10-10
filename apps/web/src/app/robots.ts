import { isProduction, publicEnv } from "../lib/env";

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  if (!isProduction) {
    // Staging, previews and local runs must never end up in a search index.
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: new URL("/sitemap.xml", publicEnv.NEXT_PUBLIC_SITE_URL).toString(),
  };
}
