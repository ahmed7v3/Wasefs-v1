import { NextResponse, type NextRequest } from "next/server";

import { normalizeReferralCode, referralCookie } from "../../../lib/attribution-cookies";
import { isProduction } from "../../../lib/env";

/**
 * A redirect with a relative `Location`. Behind the reverse proxy the standalone server sees its
 * own bind address (`0.0.0.0:3000`) as the request host, so an absolute URL built from the request
 * would send the visitor there; the browser resolves a relative one against the address it used.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { Location: path, "Cache-Control": "no-store" },
  });
}

/**
 * `/r/<code>`: an invite link. Remembers the code for 30 days (first-party cookie) and sends the
 * visitor to the register page with it prefilled. A malformed code is not an error page: it goes
 * to a plain register page and sets nothing. Whether a well-formed code exists is the API's call at
 * sign-up, so this page cannot be used to test which codes are real.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const code = normalizeReferralCode((await context.params).code);
  if (code === null) return redirectTo("/register");
  const response = redirectTo(`/register?ref=${encodeURIComponent(code)}`);
  response.cookies.set(referralCookie(code, isProduction));
  return response;
}
