"use client";

import { useEffect } from "react";

import {
  JOIN_COOKIE,
  JOIN_COOKIE_MAX_AGE_DAYS,
  normalizeJoinSlug,
} from "../../lib/attribution-cookies";
import { writeBrowserCookie } from "../../lib/browser-cookies";

/**
 * Remembers the join link for 7 days (`wasfa_join`) so the registration, e-mail verification and
 * onboarding detour does not lose it. A server component cannot set a cookie while rendering, and
 * the signed-in shell reads this one in the browser anyway. Renders nothing.
 */
export function JoinCookie({ slug }: { slug: string }) {
  useEffect(() => {
    const valid = normalizeJoinSlug(slug);
    if (valid !== null) writeBrowserCookie(JOIN_COOKIE, valid, JOIN_COOKIE_MAX_AGE_DAYS);
  }, [slug]);
  return null;
}
