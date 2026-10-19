/*
 * Canonical rules (SEO-GEO §5.2): campaign and view parameters never create an indexable URL.
 * Everything else (e.g. `?page=2`) is kept, sorted so equal queries give equal URLs.
 */

const STRIPPED_PARAMS = new Set(["ref", "gclid", "fbclid", "ttclid", "msclkid", "sort", "_gl"]);

function isStripped(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || STRIPPED_PARAMS.has(lower);
}

/** A copy of `searchParams` without tracking/view parameters, remaining keys sorted. */
export function stripTrackingParams(searchParams: URLSearchParams): URLSearchParams {
  const kept = [...searchParams.entries()].filter(([name]) => !isStripped(name));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return new URLSearchParams(kept);
}

/** The clean URL of `url`: tracking parameters and the fragment removed. */
export function canonicalUrl(url: string | URL): string {
  const parsed = new URL(url);
  parsed.search = stripTrackingParams(parsed.searchParams).toString();
  parsed.hash = "";
  return parsed.toString();
}
