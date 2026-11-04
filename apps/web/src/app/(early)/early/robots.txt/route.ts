import { AI_CRAWLERS } from "@wasfa/shared/settings";

import { EARLY_ORIGIN } from "../../../../lib/early-host";
import { isProduction } from "../../../../lib/env";
import { getPublicSettings } from "../../../../lib/public-settings";

/**
 * robots.txt of the early subdomain (the proxy rewrites `/robots.txt` here). Same policy as the main
 * site (SEO-GEO §5.3): everything open in production except AI crawlers the owner switched off;
 * staging and previews are closed.
 */
export async function GET(): Promise<Response> {
  let body: string;
  if (!isProduction) {
    body = "User-agent: *\nDisallow: /\n";
  } else {
    const { seo } = await getPublicSettings();
    const blocked = AI_CRAWLERS.filter((bot) => seo.aiCrawlers[bot] === false);
    body = [
      "User-agent: *",
      "Allow: /",
      "Disallow: /c/",
      "",
      ...blocked.flatMap((bot) => [`User-agent: ${bot}`, "Disallow: /", ""]),
      `Sitemap: ${EARLY_ORIGIN}/sitemap.xml`,
      "",
    ].join("\n");
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
