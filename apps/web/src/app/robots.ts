import { isProduction, publicEnv } from "../lib/env";
import { getPublicSettings } from "../lib/public-settings";
import { robotsRules } from "../lib/seo-robots";

import type { MetadataRoute } from "next";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { seo } = await getPublicSettings();
  return robotsRules(seo, publicEnv.NEXT_PUBLIC_SITE_URL, isProduction);
}
