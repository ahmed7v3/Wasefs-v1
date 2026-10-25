import type {
  ContentCategory,
  ContentItem,
  ContentPerson,
  ContentRevision,
  ContentTag,
  MediaAssetRecord,
} from "@wasfa/db";
import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

/*
 * What the public read API loads from the database. Narrow `Pick`s on purpose: the mapper can only
 * touch fields that are allowed to reach the public (never `body_md`, `api_key_id`, comments...).
 */

export type ItemRow = Pick<
  ContentItem,
  | "id"
  | "type"
  | "locale"
  | "translationGroupId"
  | "slug"
  | "status"
  | "categoryId"
  | "primaryAuthorId"
  | "reviewerId"
  | "featuredMediaId"
  | "seo"
  | "flags"
  | "currentRevisionId"
  | "reviewedRevisionId"
  | "publishedRevisionId"
  | "reviewedAt"
  | "publishedAt"
  | "firstPublishedAt"
  | "contentUpdatedAt"
  | "updatedAt"
  | "archivedRedirectTo"
>;

export type RevisionRow = Pick<
  ContentRevision,
  | "id"
  | "title"
  | "excerpt"
  | "definition"
  | "bodyHtml"
  | "toc"
  | "wordCount"
  | "readingMinutes"
  | "createdAt"
>;

export type PersonRow = Pick<
  ContentPerson,
  | "id"
  | "slug"
  | "nameAr"
  | "nameEn"
  | "credentialsAr"
  | "credentialsEn"
  | "licenceNumber"
  | "showLicence"
  | "bioMdAr"
  | "bioMdEn"
  | "sameAs"
  | "photoMediaId"
  | "active"
  | "updatedAt"
>;

export type CategoryRow = Pick<
  ContentCategory,
  | "id"
  | "slugAr"
  | "slugEn"
  | "nameAr"
  | "nameEn"
  | "descriptionAr"
  | "descriptionEn"
  | "requiresMedicalReview"
  | "seoTitleAr"
  | "seoDescriptionAr"
  | "seoTitleEn"
  | "seoDescriptionEn"
  | "updatedAt"
>;

export type TagRow = Pick<
  ContentTag,
  "id" | "slugAr" | "slugEn" | "nameAr" | "nameEn" | "descriptionAr" | "descriptionEn" | "updatedAt"
>;

export type MediaRow = Pick<
  MediaAssetRecord,
  | "id"
  | "status"
  | "width"
  | "height"
  | "focalX"
  | "focalY"
  | "altAr"
  | "altEn"
  | "blurDataUrl"
  | "variants"
  | "caption"
  | "credit"
>;

/** What a card needs (lists, related items, taxonomy pages). */
export interface CardParts {
  item: ItemRow;
  revision: RevisionRow;
  category: CategoryRow | null;
  author: PersonRow | null;
  image: MediaRow | null;
}

/** Everything the full item page needs; `twins` are the OTHER locales' items in the translation group. */
export interface ItemParts extends CardParts {
  tags: TagRow[];
  authorPhoto: MediaRow | null;
  reviewer: PersonRow | null;
  reviewerPhoto: MediaRow | null;
  corrections: { summary: string; createdAt: Date }[];
  ogImage: MediaRow | null;
  /** Items of the same translation group (any status); the mapper keeps only published ones. */
  twins: Pick<ItemRow, "type" | "locale" | "slug" | "publishedRevisionId">[];
}

export interface RelatedCandidate {
  id: string;
  publishedAt: Date | null;
  sameCategory: boolean;
  sharedTags: number;
  sharedEntities: number;
}

export interface TwinPaths {
  ar: string | null;
  en: string | null;
}

export interface ListFilter {
  type: ContentType;
  locale: ContentLocale;
  categoryId?: string;
  tagId?: string;
  authorId?: string;
  page: number;
  pageSize: number;
}

export type TaxonKind = "category" | "tag" | "author";

/** A category/tag/person resolved for a locale, with the facts the indexable rules need. */
export type TaxonEntity =
  | { kind: "category"; row: CategoryRow }
  | { kind: "tag"; row: TagRow }
  | { kind: "author"; row: PersonRow; photo: MediaRow | null };

export interface TaxonCount<R> {
  row: R;
  itemCount: number;
  lastItemUpdatedAt: Date | null;
}

export interface SitemapItemRow {
  item: Pick<
    ItemRow,
    | "id"
    | "type"
    | "locale"
    | "slug"
    | "translationGroupId"
    | "contentUpdatedAt"
    | "publishedAt"
    | "updatedAt"
  >;
  image: MediaRow | null;
}
