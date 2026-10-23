import { NextResponse, type NextRequest } from "next/server";

import { REFERRAL_COOKIE, normalizeReferralCode, referralCookie } from "./lib/attribution-cookies";
import { SECURITY_HEADERS, buildCsp, generateNonce, parseSources } from "./lib/csp";
import { isProduction, publicEnv } from "./lib/env";
import { hasSessionCookie, isProtectedPath, loginPath } from "./lib/route-guard";
import { isNoindexPath } from "./lib/seo-robots";

function withSecurityHeaders(response: NextResponse, csp: string, noindex = false): NextResponse {
  if (noindex) response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Content-Security-Policy", csp);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. Generates a per-request CSP nonce; Next reads
 * it from the request's CSP header and stamps it on its own scripts and styles. Pages are
 * therefore rendered per request (see `connection()` in the root layout).
 *
 * It also keeps signed-out visitors off the private page trees (cheap cookie-presence check; the
 * pages verify the session with the API). `/login` and `/register` are left alone: the page itself
 * asks `/me` and forwards people who are already signed in.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    apiOrigin: new URL(publicEnv.NEXT_PUBLIC_API_URL).origin,
    upgradeInsecure: isProduction,
    turnstile: publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY !== undefined,
    extra: {
      script: parseSources(process.env.CSP_SCRIPT_SRC_EXTRA),
      connect: parseSources(process.env.CSP_CONNECT_SRC_EXTRA),
      frame: parseSources(process.env.CSP_FRAME_SRC_EXTRA),
      img: parseSources(process.env.CSP_IMG_SRC_EXTRA),
    },
  });

  const { pathname, search } = request.nextUrl;
  // App, admin, API and auth pages stay out of search results even if a link to them leaks.
  const noindex = isNoindexPath(pathname);
  if (
    isProtectedPath(pathname) &&
    !hasSessionCookie(request.cookies.getAll().map((cookie) => cookie.name))
  ) {
    // Resolved against the request URL, so the redirect keeps the host the visitor used.
    const target = new URL(loginPath(`${pathname}${search}`), request.nextUrl);
    return withSecurityHeaders(NextResponse.redirect(target, 307), csp, noindex);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Layouts cannot see the URL; the shell layout needs it for the `?next=` of a late sign-in redirect.
  requestHeaders.set("x-pathname", `${pathname}${search}`);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = withSecurityHeaders(
    NextResponse.next({ request: { headers: requestHeaders } }),
    csp,
    noindex,
  );
  // `?ref=<code>` on any public page: first touch wins, so an existing cookie is never replaced.
  const ref = normalizeReferralCode(request.nextUrl.searchParams.get("ref"));
  if (ref !== null && !request.cookies.has(REFERRAL_COOKIE)) {
    response.cookies.set(referralCookie(ref, isProduction));
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Skip static assets and prefetches: they carry no document that a CSP would protect.
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-|apple-touch-icon.png|manifest.webmanifest|robots.txt|sitemap.xml|sitemap-|llms.txt|indexnow.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
