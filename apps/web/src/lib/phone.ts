import { normalizeDigits } from "@wasfa/shared/schemas/phone";

import type { MessageKey } from "@wasfa/shared/i18n";

export interface Country {
  iso: string;
  /** International dial code without `+`. */
  dial: string;
  name: MessageKey;
}

/** Egypt first (default), then the Gulf and the rest of the Arab world, then the diaspora. */
export const COUNTRIES: readonly Country[] = [
  { iso: "EG", dial: "20", name: "phone.country.EG" },
  { iso: "SA", dial: "966", name: "phone.country.SA" },
  { iso: "AE", dial: "971", name: "phone.country.AE" },
  { iso: "KW", dial: "965", name: "phone.country.KW" },
  { iso: "QA", dial: "974", name: "phone.country.QA" },
  { iso: "BH", dial: "973", name: "phone.country.BH" },
  { iso: "OM", dial: "968", name: "phone.country.OM" },
  { iso: "JO", dial: "962", name: "phone.country.JO" },
  { iso: "LB", dial: "961", name: "phone.country.LB" },
  { iso: "IQ", dial: "964", name: "phone.country.IQ" },
  { iso: "LY", dial: "218", name: "phone.country.LY" },
  { iso: "SD", dial: "249", name: "phone.country.SD" },
  { iso: "MA", dial: "212", name: "phone.country.MA" },
  { iso: "DZ", dial: "213", name: "phone.country.DZ" },
  { iso: "TN", dial: "216", name: "phone.country.TN" },
  { iso: "US", dial: "1", name: "phone.country.US" },
  { iso: "GB", dial: "44", name: "phone.country.GB" },
];

export const DEFAULT_COUNTRY = "EG";

export function countryByIso(iso: string): Country {
  return COUNTRIES.find((country) => country.iso === iso) ?? (COUNTRIES[0] as Country);
}

/** Digits only (Arabic-Indic digits become ASCII), without the leading zeros of a local number. */
export function nationalDigits(text: string): string {
  return normalizeDigits(text).replace(/\D/g, "").replace(/^0+/, "");
}

/** `+<dial><national>`, or an empty string while nothing is typed. */
export function toE164(dial: string, text: string): string {
  const digits = nationalDigits(text);
  return digits === "" ? "" : `+${dial}${digits}`;
}

/**
 * A number typed or pasted with its country code (`+20 101 ...` or `0020 ...`): which country it
 * belongs to, and the rest. The longest matching dial code wins (`+971` is not `+9`).
 */
export function splitInternational(text: string): { country: Country; national: string } | null {
  const compact = normalizeDigits(text).replace(/[\s\-().]/g, "");
  const digits = compact.startsWith("+")
    ? compact.slice(1)
    : compact.startsWith("00")
      ? compact.slice(2)
      : null;
  if (digits === null || !/^\d+$/.test(digits)) return null;
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((country) => digits.startsWith(country.dial));
  return match ? { country: match, national: digits.slice(match.dial.length) } : null;
}
