import { ar, t, type MessageKey } from "@wasfa/shared/i18n";

/*
 * Labels for closed value sets that the API returns as codes (`country`, `profession`, ...). The
 * keys are built from a prefix, so each lookup is checked against the dictionary: an unknown code
 * (a country we have no name for) shows the code itself instead of a missing-key hole.
 */

type LabelPrefix = "country" | "profession" | "usageIntent" | "orgType" | "orgRole" | "language";

export function label(prefix: LabelPrefix, code: string): string {
  const key = `${prefix}.${code}`;
  return Object.hasOwn(ar, key) ? t(key as MessageKey) : code;
}

/** Countries offered in the onboarding forms, in the order shown (the Arab world first). */
export const COUNTRY_CODES = [
  "EG",
  "SA",
  "AE",
  "KW",
  "QA",
  "BH",
  "OM",
  "JO",
  "LB",
  "IQ",
  "LY",
  "SD",
  "MA",
  "DZ",
  "TN",
  "PS",
  "SY",
  "YE",
  "SO",
  "US",
  "GB",
  "CA",
  "FR",
  "DE",
  "TR",
] as const;

/** Name shown for an account whose owner was anonymized (`ANONYMIZED_USER_NAME`). */
export function displayName(name: string, anonymized: string): string {
  return name === anonymized ? t("common.deletedUser") : name;
}
