/*
 * Public locales (phase4 Decision 2): Arabic is unprefixed, English lives under `/en`. The root
 * layout derives `lang`/`dir` from the path `proxy.ts` forwards (`x-pathname`); there is no route
 * tree per locale. The signed-in app and the admin stay Arabic.
 */

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ar";

const EN_PREFIX = "/en";

function pathOnly(path: string): string {
  const end = path.search(/[?#]/);
  const bare = end === -1 ? path : path.slice(0, end);
  return bare === "" ? "/" : bare;
}

/** `/en`, `/en/...` (with or without a query) are English; everything else is Arabic. */
export function localeFromPath(path: string): Locale {
  const bare = pathOnly(path);
  return bare === EN_PREFIX || bare.startsWith(`${EN_PREFIX}/`) ? "en" : "ar";
}

/** The locale-neutral path: `/en/pricing` → `/pricing`, `/en` → `/`. Drops any query. */
export function stripLocale(path: string): string {
  const bare = pathOnly(path);
  if (localeFromPath(bare) === "ar") return bare;
  const rest = bare.slice(EN_PREFIX.length);
  return rest === "" ? "/" : rest;
}

/** The path of a locale-neutral `path` in `locale`: `("/pricing", "en")` → `/en/pricing`. */
export function localizedPath(path: string, locale: Locale): string {
  const neutral = stripLocale(path);
  if (locale === "ar") return neutral;
  return neutral === "/" ? EN_PREFIX : `${EN_PREFIX}${neutral}`;
}

export function localeDir(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function ogLocale(locale: Locale): "ar_AR" | "en_US" {
  return locale === "ar" ? "ar_AR" : "en_US";
}

/**
 * hreflang map for a page that exists in both languages (SEO-GEO §5.5): each version lists itself
 * and its counterpart, `x-default` is Arabic. `null` when there is no English counterpart: a page
 * with one language carries no hreflang at all. Used by page metadata and by the sitemaps alike.
 */
export function alternates(
  pathAr: string,
  pathEn: string | null,
): { ar: string; en: string; "x-default": string } | null {
  if (pathEn === null) return null;
  return { ar: pathAr, en: pathEn, "x-default": pathAr };
}
