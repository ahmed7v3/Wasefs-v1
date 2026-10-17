import "server-only";

import { catalogResponseSchema, type CatalogResponse } from "@wasfa/shared/schemas/billing";
import { cookies } from "next/headers";

import { CURRENCY_COOKIE } from "./billing-cookie";
import { serverEnv } from "./server-env";

/*
 * Server-side reads for the pricing and checkout pages. The catalog is public: it is fetched
 * without the session cookie and kept in Next's data cache for one minute per currency, so the
 * pricing page costs the API one request per currency per window, not one per visitor.
 */

export const CATALOG_REVALIDATE_SECONDS = 60;
const CATALOG_TIMEOUT_MS = 4_000;
const CURRENCY = /^[A-Za-z]{3}$/;

type Params = Record<string, string | string[] | undefined>;

/** `?currency=` first, then the remembered choice (cookie); `undefined` lets the API pick its default. */
export async function requestedCurrency(params: Params): Promise<string | undefined> {
  const query = Array.isArray(params["currency"]) ? params["currency"][0] : params["currency"];
  if (query && CURRENCY.test(query)) return query.toUpperCase();
  const remembered = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return remembered && CURRENCY.test(remembered) ? remembered.toUpperCase() : undefined;
}

/** The public catalog for a currency, or `null` when the API cannot answer (the page says so calmly). */
export async function getCatalog(currency: string | undefined): Promise<CatalogResponse | null> {
  const query = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  try {
    const response = await fetch(`${serverEnv.API_INTERNAL_URL}/catalog${query}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: CATALOG_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = catalogResponseSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
