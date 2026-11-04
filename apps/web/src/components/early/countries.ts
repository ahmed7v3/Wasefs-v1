import { ARAB_COUNTRIES, arabCountry, type ArabCountry } from "@wasfa/shared/schemas/early-access";

/** Shown right after the detected country (EARLY-ACCESS-PLAN D5): Egypt and the GCC. */
const PRIORITY = ["EG", "SA", "AE", "KW", "QA", "BH", "OM"];

/** Detected country first, then Egypt + GCC, then the rest alphabetically (Arabic). */
export function orderCountries(detectedIso: string | null | undefined): ArabCountry[] {
  const detected = arabCountry(detectedIso)?.iso;
  const first = detected ? [detected] : [];
  const priority = PRIORITY.filter((iso) => iso !== detected);
  const head = new Set([...first, ...priority]);
  const rest = ARAB_COUNTRIES.filter((c) => !head.has(c.iso)).sort((a, b) =>
    a.nameAr.localeCompare(b.nameAr, "ar"),
  );
  return [...first, ...priority, ...rest.map((c) => c.iso)]
    .map((iso) => arabCountry(iso))
    .filter((c): c is ArabCountry => c !== undefined);
}

/** Lower-cases, folds Arabic-Indic digits and the common letter variants so "مصر"/"Egypt"/"20" all match. */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[ً-ٟـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/^\+/, "")
    .trim();
}

export function filterCountries(list: readonly ArabCountry[], query: string): ArabCountry[] {
  const q = normalizeSearch(query);
  if (q === "") return [...list];
  return list.filter(
    (c) =>
      normalizeSearch(c.nameAr).includes(q) ||
      c.nameEn.toLowerCase().includes(q) ||
      c.dial.startsWith(q) ||
      c.iso.toLowerCase() === q,
  );
}
