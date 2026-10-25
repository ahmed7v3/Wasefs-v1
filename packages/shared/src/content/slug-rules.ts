import {
  CONTENT_PAGE_SLUG_MAX,
  CONTENT_PAGE_SLUG_PATTERN,
  CONTENT_RESERVED_PAGE_SLUGS,
  CONTENT_RESERVED_ROOTS,
  CONTENT_SLUG_MAX,
  CONTENT_SLUG_PATTERN,
  type ContentType,
} from "./constants.js";

/** Why a slug is refused; the API maps every non-`ok` value to `VALIDATION_FAILED` with this reason. */
export type SlugCheck = "ok" | "bad_format" | "too_long" | "reserved";

const RESERVED_ROOTS: ReadonlySet<string> = new Set(CONTENT_RESERVED_ROOTS);
const RESERVED_PAGE_SLUGS: ReadonlySet<string> = new Set(CONTENT_RESERVED_PAGE_SLUGS);

/**
 * Checks a slug for the item's type. Articles, guides and glossary entries take one segment under their
 * section; a `page` takes up to three segments below the root, and may not shadow an app route, a content
 * section, the locale prefix or one of the hand-written marketing pages (static routes win over the
 * catch-all that renders CMS pages, so such a page would never be reachable).
 */
export function checkItemSlug(type: ContentType, slug: string): SlugCheck {
  if (type !== "page") {
    if (slug.length > CONTENT_SLUG_MAX) return "too_long";
    return CONTENT_SLUG_PATTERN.test(slug) ? "ok" : "bad_format";
  }
  if (slug.length > CONTENT_PAGE_SLUG_MAX) return "too_long";
  if (!CONTENT_PAGE_SLUG_PATTERN.test(slug)) return "bad_format";
  const root = slug.split("/")[0] ?? "";
  if (RESERVED_ROOTS.has(root) || RESERVED_PAGE_SLUGS.has(slug)) return "reserved";
  return "ok";
}
