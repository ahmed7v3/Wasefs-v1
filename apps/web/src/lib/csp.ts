/**
 * Content-Security-Policy builder for the web app. Pure functions so the policy is unit-tested;
 * `proxy.ts` calls it once per request with a fresh nonce.
 */

/** A host source such as `https://challenges.cloudflare.com` or `https://*.example.com`. */
const SOURCE_PATTERN = /^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * Parses a whitespace/comma separated list of extra sources from an env var. Anything that is not
 * a plain http(s) host (keywords, quotes, semicolons, paths) is dropped, so a typo in the env
 * cannot inject a new directive or weaken the policy with `'unsafe-inline'`.
 */
export function parseSources(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[\s,]+/).filter((source) => SOURCE_PATTERN.test(source));
}

/** 128-bit random nonce, base64. */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export interface CspOptions {
  nonce: string;
  /** React needs `eval` in development only (it rebuilds server stacks in the browser). */
  isDev: boolean;
  /** Origin of the API, allowed for `fetch`/SSE. */
  apiOrigin: string;
  /** Rewrites http subresources to https. Off outside production so local http still works. */
  upgradeInsecure: boolean;
  /** Extra sources, e.g. Turnstile (`https://challenges.cloudflare.com`) or analytics hosts. */
  extra?: {
    script?: readonly string[];
    connect?: readonly string[];
    frame?: readonly string[];
    img?: readonly string[];
  };
}

export function buildCsp({
  nonce,
  isDev,
  apiOrigin,
  upgradeInsecure,
  extra = {},
}: CspOptions): string {
  const frames = extra.frame ?? [];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        // Scripts loaded by a nonced script are trusted; host allow-lists are then ignored.
        "'strict-dynamic'",
        ...(extra.script ?? []),
        ...(isDev ? ["'unsafe-eval'"] : []),
      ],
    ],
    ["style-src", ["'self'", `'nonce-${nonce}'`]],
    ["img-src", ["'self'", "blob:", "data:", ...(extra.img ?? [])]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", apiOrigin, ...(extra.connect ?? [])]],
    ["frame-src", frames.length > 0 ? [...frames] : ["'none'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([name, sources]) => `${name} ${sources.join(" ")}`);
  if (upgradeInsecure) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Headers set on every page response next to the CSP. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Camera is for photographing prescriptions later; everything else sensitive stays off.
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};
