import { CONTENT_PATH_PREFIX, type ContentLocale, type ContentType } from "./constants.js";

/** Public URL path of an item: Arabic unprefixed, English under `/en` (SEO-GEO §2). */
export function contentPath(type: ContentType, locale: ContentLocale, slug: string): string {
  const localePrefix = locale === "en" ? "/en" : "";
  return `${localePrefix}${CONTENT_PATH_PREFIX[type]}/${slug}`;
}
