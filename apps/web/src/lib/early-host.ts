/*
 * The pre-launch subdomain (docs/EARLY-ACCESS-PLAN.md D1). `proxy.ts` rewrites its requests to the
 * `/early/*` route tree. Pure functions, unit-testable; `EARLY_DOMAIN` is read from the environment
 * by the callers so tests can pass their own.
 */

export const EARLY_DEFAULT_DOMAIN = "early.wasfa.online";

/** Canonical origin of the page (links, JSON-LD, share text). */
export const EARLY_ORIGIN = `https://${EARLY_DEFAULT_DOMAIN}`;

/** Dev hosts always count as the early host (`http://early.localhost:3000`). */
const DEV_HOST = "early.localhost";

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/** The configured early domain; anything that is not a plain hostname falls back to the default. */
export function earlyDomain(raw: string | undefined): string {
  const value = raw?.trim().toLowerCase();
  return value && DOMAIN_PATTERN.test(value) ? value : EARLY_DEFAULT_DOMAIN;
}

/** `host` is a `Host` / `X-Forwarded-Host` value (a port is allowed). */
export function isEarlyHost(host: string | null | undefined, domain: string): boolean {
  if (!host) return false;
  const name = (host.split(",")[0] ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  return name === domain || name === DEV_HOST;
}

/** Paths the early host serves as they are: Next's own assets, API routes and the generated `/early/*` files. */
export function isEarlyPassthrough(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/early" ||
    pathname.startsWith("/early/") ||
    /\.[a-z0-9]{2,5}$/i.test(pathname.replace(/\.(txt|xml)$/i, ""))
  );
}

/** Public path on the early host for a request path of the main app tree, e.g. `/early/privacy` → `/privacy`. */
export function earlyPublicPath(pathname: string): string {
  const rest = pathname.replace(/^\/early/, "");
  return rest === "" ? "/" : rest;
}

/** Variant of the A/B headline (cookie `ea_v`); crawlers always get "a". */
export const EARLY_VARIANT_COOKIE = "ea_v";
