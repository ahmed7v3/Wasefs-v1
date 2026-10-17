/*
 * Optimistic route protection for `proxy.ts`. It only checks that a session cookie EXISTS, so signed-out
 * visitors never render a private page; whether the session is still valid is decided by the API on the
 * page itself (`requireMe`). A forged cookie therefore gets no data, only a redirect from the page.
 */

/** Page trees that need a signed-in user. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/account",
  "/admin",
  "/analyze",
  "/ai",
  "/checkout",
  "/billing",
] as const;

/**
 * Better Auth prefixes the cookie with `__Secure-` when it is served over https, so the name is only
 * stable at the end. Matching the suffix covers dev (`wasfa.session`) and production.
 */
export const SESSION_COOKIE_SUFFIX = "wasfa.session";

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function hasSessionCookie(cookieNames: readonly string[]): boolean {
  return cookieNames.some((name) => name.endsWith(SESSION_COOKIE_SUFFIX));
}

/** `/login?next=<target>`: the login page that comes back to `target` afterwards. */
export function loginPath(target: string): string {
  return `/login?next=${encodeURIComponent(target)}`;
}
