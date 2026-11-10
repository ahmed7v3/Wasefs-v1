/**
 * Content-Security-Policy builder for the web app. Pure functions so the policy is unit-tested;
 * `proxy.ts` calls it once per request with a fresh nonce.
 */

/** Cloudflare Turnstile loads its script from here and renders the challenge in an iframe. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

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

/**
 * `https://media.example.com` for a configured origin (MinIO serves `<origin>/<bucket>`, so a path is
 * dropped). Undefined when unset or unusable, so a bad value cannot widen the policy.
 */
export function originOf(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    // `new URL("javascript:...").origin` is the string "null"; only real web origins are useful.
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export interface CspOptions {
  nonce: string;
  /** React needs `eval` in development only (it rebuilds server stacks in the browser). */
  isDev: boolean;
  /** Origin of the API, allowed for `fetch`/SSE. */
  apiOrigin: string;
  /**
   * Origin that serves published media (`NEXT_PUBLIC_MEDIA_ORIGIN`). Always allowed for images: the
   * app renders every uploaded picture from it, so forgetting to repeat it in
   * `CSP_IMG_SRC_EXTRA` used to block them.
   */
  mediaOrigin?: string | undefined;
  /** Rewrites http subresources to https. Off outside production so local http still works. */
  upgradeInsecure: boolean;
  /** A Turnstile site key is configured: allow Cloudflare's script and challenge frame. */
  turnstile?: boolean;
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
  mediaOrigin,
  upgradeInsecure,
  turnstile = false,
  extra = {},
}: CspOptions): string {
  const turnstileSources = turnstile ? [TURNSTILE_ORIGIN] : [];
  const frames = [...turnstileSources, ...(extra.frame ?? [])];
  // `Set` keeps the header short when an operator repeats the media origin in CSP_IMG_SRC_EXTRA.
  const imgSources = [
    ...new Set([
      "'self'",
      "blob:",
      "data:",
      apiOrigin,
      ...(mediaOrigin ? [mediaOrigin] : []),
      ...(extra.img ?? []),
    ]),
  ];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${nonce}'`,
        // Scripts loaded by a nonced script are trusted; host allow-lists are then ignored.
        "'strict-dynamic'",
        ...turnstileSources,
        ...(extra.script ?? []),
        ...(isDev ? ["'unsafe-eval'"] : []),
      ],
    ],
    ["style-src", ["'self'", `'nonce-${nonce}'`]],
    // Style ATTRIBUTES (a per-image focal point and its blur-up placeholder) cannot carry a nonce.
    // Allowing only attributes keeps <style>/<link> locked to the nonce above; attributes cannot
    // run script.
    ["style-src-attr", ["'unsafe-inline'"]],
    // The API origin serves the uploaded logo and favicon (`/assets/<key>`); the media origin
    // serves every published picture (`<ContentImage>`).
    ["img-src", imgSources],
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
  // No `browsing-topics`: Chrome does not recognise it here and warns on every document.
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
};
