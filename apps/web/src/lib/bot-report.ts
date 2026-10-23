import { classifyBot } from "./bots";
import { botRoute } from "./route-template";
import { isNoindexPath } from "./seo-robots";
import { serverEnv } from "./server-env";

import type { BotHits } from "@wasfa/shared/schemas/public-site";

/** The document request of a crawler for a public page; assets, `/_next`, the API and private trees are not counted. */
export function botHitFor(
  method: string,
  pathname: string,
  userAgent: string | null,
): BotHits["hits"][number] | null {
  if (method !== "GET" && method !== "HEAD") return null;
  if (pathname.startsWith("/_next") || isNoindexPath(pathname)) return null;
  if (/\.[a-z0-9]+$/i.test(pathname)) return null;
  const bot = classifyBot(userAgent);
  return bot === null ? null : { bot, route: botRoute(pathname) };
}

/**
 * Tells the API about one crawler hit (class + route template only: no IP, no URL). Never throws
 * and never waits longer than a second; the caller hands the promise to `event.waitUntil` so the
 * page response is not delayed.
 */
export async function reportBotHit(hit: BotHits["hits"][number]): Promise<void> {
  try {
    await fetch(`${serverEnv.API_INTERNAL_URL}/internal/bot-hits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hits: [hit] }),
      signal: AbortSignal.timeout(1_000),
    });
  } catch {
    // Counting is best effort; a down API must not affect crawling.
  }
}
