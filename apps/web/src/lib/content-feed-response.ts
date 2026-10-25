import "server-only";

import { listContent } from "./content-api";
import { FEED_HEADERS, FEED_MAX_ITEMS, buildRss } from "./content-feed";
import { publicEnv } from "./env";

import type { Locale } from "./locale";
import type { PublicItemCard } from "@wasfa/shared/schemas/content";

const PAGE_SIZE = 24;

/** The latest 50 articles (three pages of 24, the API page cap) as an RSS response; an outage throws (500, retried). */
export async function feedResponse(locale: Locale): Promise<Response> {
  const items: PublicItemCard[] = [];
  for (let page = 1; items.length < FEED_MAX_ITEMS; page += 1) {
    const response = await listContent({ type: "article", locale, page, pageSize: PAGE_SIZE });
    items.push(...response.items);
    if (response.items.length < PAGE_SIZE) break;
  }
  return new Response(buildRss({ locale, items, siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL }), {
    headers: FEED_HEADERS,
  });
}
