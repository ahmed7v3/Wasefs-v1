import { resolveCurrency, type Market } from "../../catalog/market.js";

import type { SettingValue } from "@wasfa/shared/settings";

/** Calling code (digits after the +) to country, for the markets the owner sells in. */
const CALLING_CODES: Readonly<Record<string, string>> = {
  "20": "EG",
  "966": "SA",
  "971": "AE",
  "965": "KW",
  "974": "QA",
  "973": "BH",
  "968": "OM",
  "962": "JO",
};

/** The country of an E.164 number, or null when the number is unknown or not in the map. */
export function countryOfPhone(phone: string | null): string | null {
  if (phone === null || !phone.startsWith("+")) return null;
  const digits = phone.slice(1);
  // Calling codes are prefix-free, so the first match is the only one.
  for (const length of [3, 2]) {
    const country = CALLING_CODES[digits.slice(0, length)];
    if (country !== undefined) return country;
  }
  return null;
}

/**
 * The market a chat is priced in: the country from the number, the currency from the same rule the
 * web catalog uses (the country's currency when enabled, else the default).
 */
export function phoneMarket(phone: string | null, currency: SettingValue<"currency">): Market {
  const country = countryOfPhone(phone);
  return {
    currency: resolveCurrency({}, country === null ? {} : { "cf-ipcountry": country }, currency),
    country,
  };
}
