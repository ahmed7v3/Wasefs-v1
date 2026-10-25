import { contentPath, requiresMedicalReview } from "@wasfa/shared/content";
import {
  contentFlagsSchema,
  contentSeoSchema,
  sitePathSchema,
  tocEntrySchema,
  type ContentSeo,
  type PublicImage,
  type PublicItem,
  type PublicItemCard,
  type PublicPathState,
  type PublicPerson,
} from "@wasfa/shared/schemas/content";

import type {
  CardParts,
  CategoryRow,
  ItemParts,
  ItemRow,
  MediaRow,
  PersonRow,
  RelatedCandidate,
  TagRow,
  TwinPaths,
} from "./public-content.types.js";
import type { ContentLocale } from "@wasfa/shared/content/constants";

/*
 * Pure row -> DTO mapping for the public content API. No I/O: every rule that decides what the public
 * sees (reviewer visibility, locale fallbacks, indexability, related scoring) lives here so it is
 * unit-tested without a database. Fields not named here never leave the API.
 */

/** The tag indexable threshold (SEO-GEO §2). */
export const TAG_MIN_ITEMS = 5;
export const RELATED_LIMIT = 4;
export const PATH_STATE_CAP = 20_000;
export const SITEMAP_PAGE_SIZE = 10_000;

const iso = (date: Date): string => date.toISOString();

const localePrefix = (locale: ContentLocale): string => (locale === "en" ? "/en" : "");

/** Locale-specific text with a fallback to Arabic when the English value is empty. */
export function localized(
  ar: string,
  en: string | null | undefined,
  locale: ContentLocale,
): string {
  if (locale === "en" && en !== null && en !== undefined && en.trim() !== "") return en;
  return ar;
}

// --- paths -------------------------------------------------------------------------------------

export function categoryPath(locale: ContentLocale, slug: string): string {
  return `${localePrefix(locale)}/blog/c/${slug}`;
}
export function tagPath(locale: ContentLocale, slug: string): string {
  return `${localePrefix(locale)}/blog/t/${slug}`;
}
export function authorPath(locale: ContentLocale, slug: string): string {
  return `${localePrefix(locale)}/authors/${slug}`;
}

/** A category is reachable in a locale only when it has a slug for it. */
export function categorySlug(
  category: Pick<CategoryRow, "slugAr" | "slugEn">,
  locale: ContentLocale,
) {
  return locale === "en" ? category.slugEn : category.slugAr;
}
export function tagSlug(tag: Pick<TagRow, "slugAr" | "slugEn">, locale: ContentLocale) {
  return locale === "en" ? tag.slugEn : tag.slugAr;
}

// --- people ------------------------------------------------------------------------------------

export const personName = (person: PersonRow, locale: ContentLocale): string =>
  localized(person.nameAr, person.nameEn, locale);
export const personCredentials = (person: PersonRow, locale: ContentLocale): string =>
  localized(person.credentialsAr, person.credentialsEn, locale);
export const personBio = (person: PersonRow, locale: ContentLocale): string =>
  localized(person.bioMdAr, person.bioMdEn, locale);

/** An author page is indexable only for an active profile that shows credentials or a bio. */
export function authorIndexable(person: PersonRow, locale: ContentLocale): boolean {
  return (
    person.active &&
    (personCredentials(person, locale).trim() !== "" || personBio(person, locale).trim() !== "")
  );
}

/** A tag page is indexable only with enough published items AND an intro (thin tag pages hurt the site). */
export function tagIndexable(tag: TagRow, locale: ContentLocale, itemCount: number): boolean {
  const description = locale === "en" ? tag.descriptionEn : tag.descriptionAr;
  return itemCount >= TAG_MIN_ITEMS && description.trim() !== "";
}

// --- images ------------------------------------------------------------------------------------

/** `null` for an asset that is not ready (no variants to serve) or has no known size. */
export function publicImage(media: MediaRow | null, locale: ContentLocale): PublicImage | null {
  if (media?.status !== "ready" || media.width === null || media.height === null) return null;
  const primary = locale === "en" ? media.altEn : media.altAr;
  const other = locale === "en" ? media.altAr : media.altEn;
  return {
    width: media.width,
    height: media.height,
    focalX: media.focalX,
    focalY: media.focalY,
    blurDataUrl: media.blurDataUrl,
    variants: media.variants,
    alt: primary?.trim() ? primary : (other ?? ""),
    caption: media.caption,
    credit: media.credit,
  };
}

/** Largest JPEG variant as an absolute URL under the media origin (sitemap image extension). */
export function largestJpegUrl(media: MediaRow | null, origin: string | undefined): string | null {
  if (media?.status !== "ready" || origin === undefined || origin === "") return null;
  let best: { key: string; width: number } | null = null;
  for (const variant of media.variants) {
    if (variant.format === "jpeg" && (best === null || variant.width > best.width)) best = variant;
  }
  return best === null ? null : `${origin.replace(/\/+$/, "")}/${best.key}`;
}

// --- people and taxonomy refs ------------------------------------------------------------------

export function publicPerson(
  person: PersonRow,
  photo: MediaRow | null,
  locale: ContentLocale,
): PublicPerson {
  return {
    slug: person.slug,
    name: personName(person, locale),
    credentials: personCredentials(person, locale),
    path: authorPath(locale, person.slug),
    photo: publicImage(photo, locale),
  };
}

export function categoryRef(category: CategoryRow | null, locale: ContentLocale) {
  if (category === null) return null;
  const slug = categorySlug(category, locale);
  if (slug === null) return null;
  return {
    slug,
    name: localized(category.nameAr, category.nameEn, locale),
    path: categoryPath(locale, slug),
  };
}

export function tagRef(tag: TagRow, locale: ContentLocale) {
  const slug = tagSlug(tag, locale);
  if (slug === null) return null;
  return { slug, name: localized(tag.nameAr, tag.nameEn, locale), path: tagPath(locale, slug) };
}

// --- items -------------------------------------------------------------------------------------

const itemPath = (item: Pick<ItemRow, "type" | "locale" | "slug">): string =>
  contentPath(item.type, item.locale, item.slug);

/** Something never published (an unpublished draft being previewed) falls back to its revision date. */
const publishedInstant = (parts: CardParts): Date =>
  parts.item.publishedAt ?? parts.item.firstPublishedAt ?? parts.revision.createdAt;
const updatedInstant = (parts: CardParts): Date =>
  parts.item.contentUpdatedAt ?? parts.item.updatedAt;

export function toCard(parts: CardParts): PublicItemCard {
  const { item, revision } = parts;
  return {
    id: item.id,
    type: item.type,
    locale: item.locale,
    slug: item.slug,
    path: itemPath(item),
    title: revision.title,
    excerpt: revision.excerpt,
    definition: revision.definition,
    publishedAt: iso(publishedInstant(parts)),
    contentUpdatedAt: iso(updatedInstant(parts)),
    readingMinutes: revision.readingMinutes,
    category: categoryRef(parts.category, item.locale),
    author:
      parts.author === null
        ? null
        : {
            name: personName(parts.author, item.locale),
            path: authorPath(item.locale, parts.author.slug),
          },
    image: publicImage(parts.image, item.locale),
  };
}

/** The item's own path for its locale, plus every OTHER locale that has a published twin. */
export function alternatesOf(
  item: Pick<ItemRow, "type" | "locale" | "slug">,
  twins: ItemParts["twins"],
): TwinPaths {
  const result: TwinPaths = { ar: null, en: null };
  result[item.locale] = itemPath(item);
  for (const twin of twins) {
    if (twin.locale === item.locale || twin.publishedRevisionId === null) continue;
    result[twin.locale] = itemPath(twin);
  }
  return result;
}

function parseSeo(raw: unknown): ContentSeo {
  const parsed = contentSeoSchema.safeParse(raw);
  return parsed.success ? parsed.data : contentSeoSchema.parse({});
}

/** A canonical override is a site path or an https URL; anything else is ignored. */
export function canonicalOf(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (sitePathSchema.safeParse(trimmed).success) return trimmed;
  try {
    return new URL(trimmed).protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

/** True when the item SEO settings allow indexing (sitemaps list only these). */
export function isIndexable(seo: unknown): boolean {
  return parseSeo(seo).robots !== "noindex";
}

/**
 * The reviewer block is shown only for the revision that was actually reviewed (later edits are not
 * "reviewed by" anyone until approved again) and only where review applies to the item.
 */
export function reviewerVisible(parts: ItemParts): boolean {
  const { item, category, reviewer, revision } = parts;
  return (
    reviewer !== null &&
    item.reviewedAt !== null &&
    item.reviewedRevisionId === revision.id &&
    requiresMedicalReview({
      type: item.type,
      categoryRequiresReview: category?.requiresMedicalReview ?? null,
    })
  );
}

export function toItem(parts: ItemParts, related: PublicItemCard[]): PublicItem {
  const { item, revision } = parts;
  const locale = item.locale;
  const seo = parseSeo(item.seo);
  const flags = contentFlagsSchema.safeParse(item.flags);
  const title = seo.title || revision.title;
  const description = seo.description || revision.excerpt;
  const reviewer =
    reviewerVisible(parts) && parts.reviewer !== null && item.reviewedAt !== null
      ? {
          ...publicPerson(parts.reviewer, parts.reviewerPhoto, locale),
          reviewedAt: iso(item.reviewedAt),
          licence:
            parts.reviewer.showLicence && parts.reviewer.licenceNumber
              ? parts.reviewer.licenceNumber
              : null,
        }
      : null;

  return {
    ...toCard(parts),
    bodyHtml: revision.bodyHtml,
    toc: tocEntrySchema.array().catch([]).parse(revision.toc),
    wordCount: revision.wordCount,
    firstPublishedAt: iso(item.firstPublishedAt ?? publishedInstant(parts)),
    tags: parts.tags.flatMap((tag) => {
      const ref = tagRef(tag, locale);
      return ref === null ? [] : [ref];
    }),
    author: parts.author === null ? null : publicPerson(parts.author, parts.authorPhoto, locale),
    reviewer,
    corrections: [...parts.corrections]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((correction) => ({ summary: correction.summary, at: iso(correction.createdAt) })),
    seo: {
      title,
      description,
      canonical: canonicalOf(seo.canonical),
      robots: seo.robots,
      ogTitle: seo.ogTitle || title,
      ogDescription: seo.ogDescription || description,
      ogImage: publicImage(parts.ogImage ?? parts.image, locale),
    },
    flags: flags.success ? flags.data : contentFlagsSchema.parse({}),
    alternates: alternatesOf(item, parts.twins),
    related,
  };
}

// --- related -----------------------------------------------------------------------------------

/** Weights of CONTENT-PLATFORM §11.5: shared entities 3, same category 2, each shared tag 1. */
export function relatedScore(candidate: RelatedCandidate): number {
  return 3 * candidate.sharedEntities + (candidate.sameCategory ? 2 : 0) + candidate.sharedTags;
}

/** Highest score first; ties go to the newer item, then the id (stable). The item itself is never picked. */
export function pickRelated(
  candidates: RelatedCandidate[],
  selfId: string,
  limit = RELATED_LIMIT,
): string[] {
  return candidates
    .filter((candidate) => candidate.id !== selfId)
    .sort(
      (a, b) =>
        relatedScore(b) - relatedScore(a) ||
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
        (a.id < b.id ? 1 : -1),
    )
    .slice(0, limit)
    .map((candidate) => candidate.id);
}

// --- path state and sitemap --------------------------------------------------------------------

const isSitePath = (path: string): boolean => sitePathSchema.safeParse(path).success;

/** Only well-formed site paths reach the in-memory maps of the web proxy. */
export function shapePathState(
  redirects: { fromPath: string; toPath: string }[],
  gone: string[],
): PublicPathState {
  const map: Record<string, string> = {};
  for (const row of redirects.slice(0, PATH_STATE_CAP)) {
    if (isSitePath(row.fromPath) && isSitePath(row.toPath)) map[row.fromPath] = row.toPath;
  }
  return { redirects: map, gone: gone.filter(isSitePath).slice(0, PATH_STATE_CAP) };
}

export interface SitemapEntryInput {
  path: string;
  lastmod: Date;
  alternates: TwinPaths;
  image: MediaRow | null;
  locale: ContentLocale;
}

export function sitemapEntry(input: SitemapEntryInput, mediaOrigin: string | undefined) {
  const url = largestJpegUrl(input.image, mediaOrigin);
  const alt = publicImage(input.image, input.locale)?.alt ?? "";
  return {
    path: input.path,
    lastmod: iso(input.lastmod),
    alternates: input.alternates,
    image: url === null ? null : { url, alt },
  };
}
