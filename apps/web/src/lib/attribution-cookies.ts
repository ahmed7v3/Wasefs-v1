import {
  REFERRAL_CODE_PATTERN,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_MAX_AGE_DAYS,
  SLUG_PATTERN,
} from "@wasfa/shared/rewards";

/*
 * Where a visitor came from: an invite code (`wasfa_ref`, first touch wins) or an organization's join
 * link (`wasfa_join`). Both cookies are first-party and readable by the page, because the register
 * form prefills from the first and the signed-in shell reads the second to finish joining.
 */

export { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_DAYS };

export const JOIN_COOKIE = "wasfa_join";
export const JOIN_COOKIE_MAX_AGE_DAYS = 7;

/** Upper-cased code when it has the shape of one; anything else (including empty) is `null`. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase();
  return code && REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

/** Lower-cased slug when it has the shape of one. */
export function normalizeJoinSlug(raw: string | null | undefined): string | null {
  const slug = raw?.trim().toLowerCase();
  return slug && SLUG_PATTERN.test(slug) ? slug : null;
}

const DAY_SECONDS = 24 * 60 * 60;

/** The `wasfa_ref` cookie for `code`, in the shape `NextResponse.cookies.set` takes. */
export function referralCookie(code: string, secure: boolean) {
  return {
    name: REFERRAL_COOKIE,
    value: code,
    maxAge: REFERRAL_COOKIE_MAX_AGE_DAYS * DAY_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure,
  };
}
