import { publicEnv } from "../../../lib/env";
import { serverEnv } from "../../../lib/server-env";

/*
 * The tracked link of a Telegram ad button (docs/TELEGRAM-BOT.md, "Ads"): `/t/<token>` asks the API to
 * verify the signed token, count the click for that creative and chat, and return the button's own
 * stored https URL; we answer 302. Same rules as the web ad redirect `/a/<token>`: the destination
 * never comes from the request (no open redirect), no cookie is read or set, prefetches and HEAD
 * requests are not clicks, and a bad or expired token lands on the home page. `noindex`.
 */

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

const CLICK_TIMEOUT_MS = 3_000;

function isPrefetch(request: Request): boolean {
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  return /prefetch|prerender/i.test(purpose);
}

/** The button's URL from the API, or `null` on any failure. Only https destinations are followed. */
async function resolveTelegramAdClick(token: string, request: Request): Promise<string | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const cf = request.headers.get("cf-connecting-ip");
  const forwarded = request.headers.get("x-forwarded-for");
  // The client IP is forwarded so the API's per-IP limit does not count every visitor as this server.
  if (cf) headers["CF-Connecting-IP"] = cf;
  if (forwarded) headers["X-Forwarded-For"] = forwarded;
  try {
    const response = await fetch(
      `${serverEnv.API_INTERNAL_URL}/public/telegram-ads/click/${encodeURIComponent(token)}`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(CLICK_TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { url?: unknown } | null;
    return typeof body?.url === "string" && body.url.startsWith("https://") ? body.url : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (isPrefetch(request)) return new Response(null, { status: 204, headers: BASE_HEADERS });

  const { token } = await context.params;
  const target = await resolveTelegramAdClick(token, request);
  const location = target ?? new URL("/", publicEnv.NEXT_PUBLIC_SITE_URL).toString();
  return new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: location } });
}

/** Next would otherwise answer HEAD by running GET, which would count a click. */
export function HEAD(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}
