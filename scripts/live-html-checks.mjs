/**
 * Pure checks for the live-site guard (Phase 4 WP1 §1). No I/O, so they are unit-tested with
 * fixture strings (live-html-checks.test.mjs); check-live-html.mjs does the fetching.
 */

/** Always required, even if csp.ts changes. */
const BASE_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
];

/**
 * Mirrors the keys of SECURITY_HEADERS in apps/web/src/lib/csp.ts. Keep in sync by hand: this
 * script is plain Node with no build step and cannot import the TypeScript module.
 */
const CSP_TS_HEADERS = [
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-frame-options",
  "cross-origin-opener-policy",
];

export const REQUIRED_HEADERS = [...new Set([...BASE_HEADERS, ...CSP_TS_HEADERS])];

/** Cloudflare rewrites that break hydration or CSP: always failures. */
const FORBIDDEN = ["__cf_email__", "/cdn-cgi/scripts/", "email-protection"];
/** Cloudflare JavaScript Detections injector: a warning unless `strict` (owner decision O1). */
const WARN_ONLY = ["/cdn-cgi/challenge-platform/"];

const SCRIPT_TAG = /<script\b([^>]*)>/gi;

/**
 * @param {{ url: string, html: string, headers: Headers | Record<string, string> }} page
 * @param {{ strict?: boolean }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkPage({ url, html, headers }, { strict = false } = {}) {
  const errors = [];
  const warnings = [];

  for (const needle of FORBIDDEN) {
    if (html.includes(needle)) errors.push(`${url}: HTML contains "${needle}"`);
  }
  for (const needle of WARN_ONLY) {
    if (html.includes(needle)) {
      (strict ? errors : warnings).push(`${url}: HTML contains "${needle}"`);
    }
  }

  let unnonced = 0;
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const attrs = match[1] ?? "";
    if (/\bnonce\s*=/i.test(attrs)) continue;
    // Our JSON-LD carries the nonce too (json-ld.tsx), so no exemption for it.
    unnonced += 1;
  }
  if (unnonced > 0) errors.push(`${url}: ${unnonced} <script> tag(s) without a nonce attribute`);

  const get = (name) =>
    typeof headers.get === "function" ? headers.get(name) : (headers[name] ?? null);
  for (const name of REQUIRED_HEADERS) {
    if (!get(name)) errors.push(`${url}: missing response header ${name}`);
  }

  return { errors, warnings };
}
