import { COUNTRY_CURRENCY } from "@wasfa/shared/billing";

import type { MarketQuery } from "@wasfa/shared/schemas/billing";
import type { SettingValue } from "@wasfa/shared/settings";
import type { IncomingHttpHeaders } from "node:http";

/** Where the visitor is and which currency prices are shown in. */
export interface Market {
  currency: string;
  country: string | null;
}

const COUNTRY = /^[A-Z]{2}$/;
// Cloudflare's "unknown" and "Tor" pseudo countries.
const NO_COUNTRY = new Set(["XX", "T1"]);

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseCountry(value: string | undefined): string | null {
  const country = value?.trim().toUpperCase();
  return country && COUNTRY.test(country) && !NO_COUNTRY.has(country) ? country : null;
}

/** `CF-IPCountry`; `?country=` is honoured outside production only, so tests can pick a market. */
export function resolveCountry(
  query: MarketQuery,
  headers: IncomingHttpHeaders,
  production: boolean,
): string | null {
  const fromHeader = parseCountry(headerValue(headers, "cf-ipcountry"));
  return production ? fromHeader : (parseCountry(query.country) ?? fromHeader);
}

/**
 * `?currency=` if enabled, else the currency of the visitor's country if enabled, else the default.
 * The "remembered choice" is the web app's cookie, sent back as `?currency=`: the API stays stateless.
 */
export function resolveCurrency(
  query: MarketQuery,
  headers: IncomingHttpHeaders,
  settings: SettingValue<"currency">,
): string {
  const requested = query.currency?.trim().toUpperCase();
  if (requested && settings.enabled.includes(requested)) return requested;
  const country = parseCountry(headerValue(headers, "cf-ipcountry"));
  const local = country ? COUNTRY_CURRENCY[country] : undefined;
  if (local && settings.enabled.includes(local)) return local;
  return settings.default;
}

export function resolveMarket(
  query: MarketQuery,
  headers: IncomingHttpHeaders,
  settings: SettingValue<"currency">,
  production: boolean,
): Market {
  return {
    currency: resolveCurrency(query, headers, settings),
    country: resolveCountry(query, headers, production),
  };
}
