import { NextResponse, type NextRequest } from "next/server";

import { SECURITY_HEADERS, buildCsp, generateNonce, parseSources } from "./lib/csp";
import { isProduction, publicEnv } from "./lib/env";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. Generates a per-request CSP nonce; Next reads
 * it from the request's CSP header and stamps it on its own scripts and styles. Pages are
 * therefore rendered per request (see `connection()` in the root layout).
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    apiOrigin: new URL(publicEnv.NEXT_PUBLIC_API_URL).origin,
    upgradeInsecure: isProduction,
    extra: {
      script: parseSources(process.env.CSP_SCRIPT_SRC_EXTRA),
      connect: parseSources(process.env.CSP_CONNECT_SRC_EXTRA),
      frame: parseSources(process.env.CSP_FRAME_SRC_EXTRA),
      img: parseSources(process.env.CSP_IMG_SRC_EXTRA),
    },
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Skip static assets and prefetches: they carry no document that a CSP would protect.
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
