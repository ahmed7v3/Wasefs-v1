import { headers } from "next/headers";

/** Cloudflare's "unknown" (XX) and "Tor" (T1) pseudo-countries carry no targeting value. */
const PSEUDO_COUNTRIES = new Set(["XX", "T1"]);

/**
 * The visitor's ISO country from Cloudflare's `cf-ipcountry` header, for ad targeting; `undefined`
 * when it is absent or not a real two-letter code (country targeting is then skipped by the API).
 */
export async function adCountry(): Promise<string | undefined> {
  const raw = (await headers()).get("cf-ipcountry")?.trim().toUpperCase();
  if (!raw || !/^[A-Z]{2}$/.test(raw) || PSEUDO_COUNTRIES.has(raw)) return undefined;
  return raw;
}
