import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

import { REFERRAL_COOKIE, normalizeReferralCode, referralCookie } from "./lib/attribution-cookies";
import { botHitFor, reportBotHit } from "./lib/bot-report";
import { classifyBot } from "./lib/bots";
import { getPublicPathState } from "./lib/content-api";
import { SECURITY_HEADERS, buildCsp, generateNonce, originOf, parseSources } from "./lib/csp";
import {
  EARLY_VARIANT_COOKIE,
  earlyDomain,
  earlyPublicPath,
  isEarlyHost,
  isEarlyPassthrough,
} from "./lib/early-host";
import { isProduction, publicEnv } from "./lib/env";
import { createPathStateCache, goneHtml, isContentPath, matchPathState } from "./lib/path-state";
import { hasSessionCookie, isProtectedPath, loginPath } from "./lib/route-guard";
import { isNoindexPath } from "./lib/seo-robots";

/** 301/410 maps for the content prefixes, kept in process for a minute (CONTENT-PLATFORM §11.5). */
const pathStates = createPathStateCache(getPublicPathState);

const EARLY_VARIANTS = ["a", "b", "c"] as const;

/** Headline A/B (EARLY-ACCESS-PLAN D6/§2): sticky per session, so the server renders the final text. */
function earlyVariant(request: NextRequest): { variant: string; isNew: boolean } {
  const existing = request.cookies.get(EARLY_VARIANT_COOKIE)?.value;
  if (existing && (EARLY_VARIANTS as readonly string[]).includes(existing)) {
    return { variant: existing, isNew: false };
  }
  // Crawlers always read the default headline.
  if (classifyBot(request.headers.get("user-agent")) !== null)
    return { variant: "a", isNew: false };
  const pick = EARLY_VARIANTS[Math.floor(Math.random() * EARLY_VARIANTS.length)] ?? "a";
  return { variant: pick, isNew: true };
}

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
export async function proxy(request: NextRequest, event: NextFetchEvent): Promise<NextResponse> {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    apiOrigin: new URL(publicEnv.NEXT_PUBLIC_API_URL).origin,
    mediaOrigin: originOf(publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN),
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
  // `early.wasfa.online` is the same app: its paths are served from the `/early` route tree.
  const domain = earlyDomain(process.env.EARLY_DOMAIN);
  const onEarlyHost = isEarlyHost(request.headers.get("host"), domain);
  if (!onEarlyHost && isProduction && (pathname === "/early" || pathname.startsWith("/early/"))) {
    const target = new URL(`${earlyPublicPath(pathname)}${search}`, `https://${domain}`);
    return withSecurityHeaders(NextResponse.redirect(target, 301), csp, false);
  }
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

  if ((request.method === "GET" || request.method === "HEAD") && isContentPath(pathname)) {
    const match = matchPathState((await pathStates.get()) ?? { redirects: {}, gone: [] }, pathname);
    if (match?.kind === "redirect") {
      // The query string is dropped on purpose: the new URL is built from the target path alone.
      return withSecurityHeaders(
        NextResponse.redirect(new URL(match.to, request.nextUrl), 301),
        csp,
        noindex,
      );
    }
    if (match?.kind === "gone") {
      const gone = new NextResponse(goneHtml(pathname), {
        status: 410,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-robots-tag": "noindex",
          "cache-control": "public, max-age=300",
        },
      });
      return withSecurityHeaders(gone, csp, noindex);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Layouts cannot see the URL; the shell layout needs it for the `?next=` of a late sign-in redirect.
  requestHeaders.set("x-pathname", `${pathname}${search}`);
  requestHeaders.set("Content-Security-Policy", csp);

  const rewriteEarly = onEarlyHost && !isEarlyPassthrough(pathname);
  const variant = rewriteEarly && pathname === "/" ? earlyVariant(request) : null;
  if (variant !== null) requestHeaders.set("x-early-variant", variant.variant);
  let forwarded: NextResponse;
  if (rewriteEarly) {
    const url = request.nextUrl.clone();
    url.pathname = `/early${pathname === "/" ? "" : pathname}`;
    forwarded = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  } else {
    forwarded = NextResponse.next({ request: { headers: requestHeaders } });
  }
  const response = withSecurityHeaders(forwarded, csp, noindex);
  if (variant?.isNew) {
    response.cookies.set(EARLY_VARIANT_COOKIE, variant.variant, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: isProduction,
    });
  }
  // Crawler visits are counted after the response is on its way (class + route template only).
  const botHit = botHitFor(request.method, pathname, request.headers.get("user-agent"));
  if (botHit !== null) event.waitUntil(reportBotHit(botHit));
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
      source:
        "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-|apple-touch-icon.png|manifest.webmanifest|robots.txt|sitemap.xml|sitemap-|llms.txt|indexnow.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      // The early subdomain serves its own robots.txt, sitemap and llms.txt from `/early/*`.
      source: "/(robots.txt|sitemap.xml|llms.txt)",
      has: [{ type: "host", value: "early\\..+" }],
    },
  ],
};
