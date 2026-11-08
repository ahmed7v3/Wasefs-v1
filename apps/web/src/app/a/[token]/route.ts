import { resolveAdClick } from "../../../lib/ads-server";
import { publicEnv } from "../../../lib/env";

/*
 * The first-party ad redirect (docs/ADS.md §5): `/a/<token>` verifies the signed token through the
 * API, which counts the click for that creative, placement and day and returns the creative's own
 * stored https URL; we answer 302. The destination never comes from the request, so this is not an
 * open redirect. No cookie is read or set, nothing about the visitor is stored. Prefetches and HEAD
 * requests are not clicks. The path is `noindex` and disallowed in robots.txt.
 */

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;

function isPrefetch(request: Request): boolean {
  const purpose = request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "";
  return /prefetch|prerender/i.test(purpose);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  if (isPrefetch(request)) return new Response(null, { status: 204, headers: BASE_HEADERS });

  const { token } = await context.params;
  const target = await resolveAdClick(token, {
    cfConnectingIp: request.headers.get("cf-connecting-ip"),
    forwardedFor: request.headers.get("x-forwarded-for"),
  });
  // A bad or expired token lands on the home page, never on an error screen.
  const location = target ?? new URL("/", publicEnv.NEXT_PUBLIC_SITE_URL).toString();
  return new Response(null, { status: 302, headers: { ...BASE_HEADERS, Location: location } });
}

/** Next would otherwise answer HEAD by running GET, which would count a click. */
export function HEAD(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}
