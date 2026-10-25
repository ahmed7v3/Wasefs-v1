import { CONTENT_LOCALES, CONTENT_TYPES } from "@wasfa/shared/content/constants";
import { CONTENT_CACHE_TAGS, type ContentChangedPayload } from "@wasfa/shared/schemas/content";

import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

type Kind = ContentChangedPayload["kind"];

const TAXONOMY_KINDS: readonly Kind[] = [
  "taxonomy",
  "redirects",
  "moved",
  "archived",
  "published",
  "unpublished",
];
const PATH_STATE_KINDS: readonly Kind[] = [
  "moved",
  "archived",
  "unpublished",
  "redirects",
  "taxonomy",
];
const TAXONOMY_SITEMAP_KINDS: readonly Kind[] = ["taxonomy", "published", "unpublished"];

/** The item a change is about; `null` = it no longer exists (or the change has no item). */
export interface ChangedItem {
  type: ContentType;
  locale: ContentLocale;
}

/**
 * Cache tags to purge for one `content.changed` event. A known item narrows lists, glossary, sitemap
 * and feed to its type and locale; an unknown one (deleted, or a taxonomy/redirect change) purges all
 * of them, which is cheap and always safe.
 */
export function deriveCacheTags(input: {
  kind: Kind;
  itemId: string | null;
  item: ChangedItem | null;
}): string[] {
  const { kind, itemId, item } = input;
  const types: readonly ContentType[] = item ? [item.type] : CONTENT_TYPES;
  const locales: readonly ContentLocale[] = item ? [item.locale] : CONTENT_LOCALES;
  const tags = new Set<string>();

  if (itemId !== null) tags.add(CONTENT_CACHE_TAGS.item(itemId));
  for (const type of types) {
    for (const locale of locales) tags.add(CONTENT_CACHE_TAGS.list(type, locale));
  }
  if (TAXONOMY_KINDS.includes(kind)) {
    for (const locale of CONTENT_LOCALES) tags.add(CONTENT_CACHE_TAGS.taxonomy(locale));
  }
  if (PATH_STATE_KINDS.includes(kind)) tags.add(CONTENT_CACHE_TAGS.pathState);
  if (types.includes("glossary")) {
    for (const locale of locales) tags.add(CONTENT_CACHE_TAGS.glossary(locale));
  }
  for (const type of types) tags.add(CONTENT_CACHE_TAGS.sitemap(type));
  if (TAXONOMY_SITEMAP_KINDS.includes(kind)) {
    for (const sitemapKind of ["category", "tag", "author"]) {
      tags.add(CONTENT_CACHE_TAGS.sitemap(sitemapKind));
    }
  }
  if (types.includes("article")) {
    for (const locale of locales) tags.add(CONTENT_CACHE_TAGS.feed(locale));
  }
  return [...tags];
}
