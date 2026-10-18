import { NextResponse, type NextRequest } from "next/server";

import { normalizeReferralCode, referralCookie } from "../../../lib/attribution-cookies";
import { isProduction } from "../../../lib/env";

/**
 * `/r/<code>`: an invite link. Remembers the code for 30 days (first-party cookie) and sends the
 * visitor to the register page with it prefilled. A malformed code is not an error page: it goes
 * to a plain register page and sets nothing. Whether a well-formed code exists is the API's call at
 * sign-up, so this page cannot be used to test which codes are real.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const code = normalizeReferralCode((await context.params).code);
  if (code === null) {
    const plain = NextResponse.redirect(new URL("/register", request.nextUrl), 302);
    plain.headers.set("Cache-Control", "no-store");
    return plain;
  }
  const response = NextResponse.redirect(
    new URL(`/register?ref=${encodeURIComponent(code)}`, request.nextUrl),
    302,
  );
  response.cookies.set(referralCookie(code, isProduction));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
