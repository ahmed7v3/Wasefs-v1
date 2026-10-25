import {
  CONTENT_LOCALES,
  CONTENT_PAGE_SLUG_PATTERN,
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  CONTENT_TYPES,
  PERSON_ROLES,
  REDIRECT_REASONS,
  REVISION_KINDS,
} from "@wasfa/shared/content/constants";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { mediaAssets } from "./media.js";
import { users } from "./users.js";

/*
 * The content platform (Phase 4, WP3; CONTENT-PLATFORM §3 and §11). An item is the stable identity
 * (slug, type, locale, workflow status, pointers); every save writes an immutable `content_revisions`
 * row, and the item points at the current / reviewed / published / submitted revisions. The pointers
 * and `content_revisions.parent_revision_id` are circular with the revisions table, so Drizzle sees
 * plain uuid columns and migration 0023 adds the DEFERRABLE foreign keys by hand.
 */

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const CONTENT_LINK_KINDS = ["internal", "external"] as const;
export const CONTENT_ENTITY_KINDS = ["drug", "glossary"] as const;
export const CONTENT_ENTITY_SOURCES = ["explicit", "auto"] as const;
export const CONTENT_MEDIA_ROLES = ["featured", "body", "og", "photo"] as const;
export const CONTENT_ACTOR_TYPES = ["user", "api_key", "system"] as const;
export const CONTENT_REVIEW_COMMENT_KINDS = ["request_changes", "approve", "note"] as const;

export interface ContentDiffStats {
  added: number;
  removed: number;
}

export const contentPeople = pgTable(
  "content_people",
  {
    id: idColumn(),
    slug: text().notNull().unique("content_people_slug_key"),
    nameAr: text().notNull(),
    nameEn: text(),
    role: text({ enum: PERSON_ROLES }).notNull(),
    credentialsAr: text().notNull().default(""),
    credentialsEn: text().notNull().default(""),
    licenceNumber: text(),
    showLicence: boolean().notNull().default(false),
    bioMdAr: text().notNull().default(""),
    bioMdEn: text().notNull().default(""),
    photoMediaId: uuid().references(() => mediaAssets.id, { onDelete: "set null" }),
    sameAs: jsonb()
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    check("content_people_role_check", inList(table.role, PERSON_ROLES)),
    uniqueIndex("content_people_user_id_key")
      .on(table.userId)
      .where(sql`${table.userId} is not null`),
  ],
);

export const contentCategories = pgTable(
  "content_categories",
  {
    id: idColumn(),
    // Depth <= 2 is enforced by the service.
    parentId: uuid().references((): AnyPgColumn => contentCategories.id, {
      onDelete: "restrict",
    }),
    slugAr: text().notNull().unique("content_categories_slug_ar_key"),
    slugEn: text().unique("content_categories_slug_en_key"),
    nameAr: text().notNull(),
    nameEn: text(),
    descriptionAr: text().notNull().default(""),
    descriptionEn: text().notNull().default(""),
    requiresMedicalReview: boolean().notNull().default(true),
    defaultReviewerId: uuid().references(() => contentPeople.id, { onDelete: "set null" }),
    seoTitleAr: text().notNull().default(""),
    seoDescriptionAr: text().notNull().default(""),
    seoTitleEn: text().notNull().default(""),
    seoDescriptionEn: text().notNull().default(""),
    sort: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [index("content_categories_parent_idx").on(table.parentId)],
);

export const contentTags = pgTable(
  "content_tags",
  {
    id: idColumn(),
    slugAr: text().unique("content_tags_slug_ar_key"),
    slugEn: text().unique("content_tags_slug_en_key"),
    nameAr: text().notNull(),
    nameEn: text(),
    descriptionAr: text().notNull().default(""),
    descriptionEn: text().notNull().default(""),
    ...timestamps(),
  },
  (table) => [
    check(
      "content_tags_slug_check",
      sql`${table.slugAr} is not null or ${table.slugEn} is not null`,
    ),
  ],
);

export const contentItems = pgTable(
  "content_items",
  {
    id: idColumn(),
    type: text({ enum: CONTENT_TYPES }).notNull(),
    locale: text({ enum: CONTENT_LOCALES }).notNull(),
    translationGroupId: uuid().notNull(),
    slug: text().notNull(),
    status: text({ enum: CONTENT_STATUSES }).notNull().default("draft"),
    // Mirror of the current revision's title, kept for lists and search.
    title: text().notNull(),
    categoryId: uuid().references(() => contentCategories.id, { onDelete: "set null" }),
    primaryAuthorId: uuid().references(() => contentPeople.id, { onDelete: "set null" }),
    reviewerId: uuid().references(() => contentPeople.id, { onDelete: "set null" }),
    featuredMediaId: uuid().references(() => mediaAssets.id, { onDelete: "set null" }),
    seo: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    flags: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    source: text({ enum: CONTENT_SOURCES }).notNull().default("editor"),
    // No FK: the api_keys table arrives with WP4.
    apiKeyId: uuid(),
    externalId: text(),
    // Circular with content_revisions: the DEFERRABLE foreign keys are added by hand in 0023.
    currentRevisionId: uuid(),
    reviewedRevisionId: uuid(),
    publishedRevisionId: uuid(),
    submittedRevisionId: uuid(),
    submittedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp({ withTimezone: true }),
    nextReviewDue: timestamp({ withTimezone: true }),
    scheduledAt: timestamp({ withTimezone: true }),
    publishedAt: timestamp({ withTimezone: true }),
    firstPublishedAt: timestamp({ withTimezone: true }),
    contentUpdatedAt: timestamp({ withTimezone: true }),
    archivedAt: timestamp({ withTimezone: true }),
    archivedRedirectTo: text(),
    wordCount: integer().notNull().default(0),
    lockVersion: integer().notNull().default(0),
    // Normalised plain text of the current revision body, set by the service.
    searchText: text().notNull().default(""),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(slug, '') || ' ' || coalesce(search_text, ''))`,
    ),
    ...timestamps(),
  },
  (table) => [
    unique("content_items_type_locale_slug_key").on(table.type, table.locale, table.slug),
    unique("content_items_translation_locale_key").on(table.translationGroupId, table.locale),
    uniqueIndex("content_items_api_external_key")
      .on(table.apiKeyId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    // Pages own a path below the root (`features/x`); every other type is one segment under its section.
    check("content_items_slug_check", matches(table.slug, CONTENT_PAGE_SLUG_PATTERN.source)),
    check(
      "content_items_slug_segments_check",
      sql`${table.type} = 'page' or position('/' in ${table.slug}) = 0`,
    ),
    check("content_items_type_check", inList(table.type, CONTENT_TYPES)),
    check("content_items_locale_check", inList(table.locale, CONTENT_LOCALES)),
    check("content_items_status_check", inList(table.status, CONTENT_STATUSES)),
    check("content_items_source_check", inList(table.source, CONTENT_SOURCES)),
    index("content_items_status_updated_idx").on(table.status, table.updatedAt.desc()),
    index("content_items_public_list_idx")
      .on(table.type, table.locale, table.publishedAt.desc())
      .where(sql`${table.publishedRevisionId} is not null`),
    index("content_items_scheduled_idx")
      .on(table.scheduledAt)
      .where(sql`${table.status} = 'scheduled'`),
    index("content_items_category_idx").on(table.categoryId),
    index("content_items_author_idx").on(table.primaryAuthorId),
    index("content_items_reviewer_idx")
      .on(table.reviewerId)
      .where(sql`${table.status} = 'in_review'`),
    index("content_items_search_tsv_idx").using("gin", table.searchTsv),
    index("content_items_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
  ],
);

/*
 * Immutable history. A trigger (migration 0023) refuses DELETE and any UPDATE of the authored
 * columns; the derived columns (html, toc, counts, minhash, quality, diff_stats) may be recomputed.
 */
export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: idColumn(),
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "restrict" }),
    number: integer().notNull(),
    kind: text({ enum: REVISION_KINDS }).notNull(),
    title: text().notNull(),
    excerpt: text().notNull().default(""),
    definition: text().notNull().default(""),
    bodyMd: text().notNull(),
    bodyHtml: text().notNull().default(""),
    toc: jsonb()
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    wordCount: integer().notNull().default(0),
    readingMinutes: integer().notNull().default(1),
    minhash: bytea(),
    quality: jsonb()
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text(),
    createdByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    createdByApiKeyId: uuid(),
    // Snapshot, so the history survives deleting the user.
    createdByName: text().notNull(),
    diffStats: jsonb()
      .$type<ContentDiffStats>()
      .notNull()
      .default(sql`'{"added":0,"removed":0}'::jsonb`),
    parentRevisionId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("content_revisions_item_number_key").on(table.itemId, table.number),
    check("content_revisions_kind_check", inList(table.kind, REVISION_KINDS)),
    index("content_revisions_item_number_idx").on(table.itemId, table.number.desc()),
  ],
);

export const contentAutosaves = pgTable(
  "content_autosaves",
  {
    id: idColumn(),
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    baseRevisionId: uuid().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    savedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("content_autosaves_item_user_key").on(table.itemId, table.userId)],
);

export const contentItemTags = pgTable(
  "content_item_tags",
  {
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    tagId: uuid()
      .notNull()
      .references(() => contentTags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ name: "content_item_tags_pkey", columns: [table.itemId, table.tagId] }),
    index("content_item_tags_tag_idx").on(table.tagId),
  ],
);

/** Replaced wholesale per item by the service on every save. */
export const contentLinks = pgTable(
  "content_links",
  {
    id: idColumn(),
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    href: text().notNull(),
    kind: text({ enum: CONTENT_LINK_KINDS }).notNull(),
    host: text(),
    anchorText: text().notNull().default(""),
    targetItemId: uuid().references(() => contentItems.id, { onDelete: "set null" }),
    rel: text().notNull().default(""),
  },
  (table) => [
    check("content_links_kind_check", inList(table.kind, CONTENT_LINK_KINDS)),
    index("content_links_item_idx").on(table.itemId),
    index("content_links_target_idx")
      .on(table.targetItemId)
      .where(sql`${table.targetItemId} is not null`),
    index("content_links_external_host_idx")
      .on(table.host)
      .where(sql`${table.kind} = 'external'`),
  ],
);

export const contentEntities = pgTable(
  "content_entities",
  {
    id: idColumn(),
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    kind: text({ enum: CONTENT_ENTITY_KINDS }).notNull(),
    slug: text().notNull(),
    source: text({ enum: CONTENT_ENTITY_SOURCES }).notNull(),
  },
  (table) => [
    unique("content_entities_item_kind_slug_key").on(table.itemId, table.kind, table.slug),
    check("content_entities_kind_check", inList(table.kind, CONTENT_ENTITY_KINDS)),
    check("content_entities_source_check", inList(table.source, CONTENT_ENTITY_SOURCES)),
    index("content_entities_kind_slug_idx").on(table.kind, table.slug),
  ],
);

/** Drives "used in N articles" in the media library. */
export const contentMediaRefs = pgTable(
  "content_media_refs",
  {
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    mediaId: uuid()
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    role: text({ enum: CONTENT_MEDIA_ROLES }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "content_media_refs_pkey",
      columns: [table.itemId, table.mediaId, table.role],
    }),
    check("content_media_refs_role_check", inList(table.role, CONTENT_MEDIA_ROLES)),
    index("content_media_refs_media_idx").on(table.mediaId),
  ],
);

export const contentCorrections = pgTable("content_corrections", {
  id: idColumn(),
  itemId: uuid()
    .notNull()
    .references(() => contentItems.id, { onDelete: "cascade" }),
  summary: text().notNull(),
  createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const slugRedirects = pgTable(
  "slug_redirects",
  {
    id: idColumn(),
    fromPath: text().notNull().unique("slug_redirects_from_path_key"),
    toPath: text().notNull(),
    reason: text({ enum: REDIRECT_REASONS }).notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("slug_redirects_reason_check", inList(table.reason, REDIRECT_REASONS)),
    check("slug_redirects_paths_check", sql`${table.fromPath} <> ${table.toPath}`),
    check(
      "slug_redirects_leading_slash_check",
      sql`${table.fromPath} like '/%' and ${table.toPath} like '/%'`,
    ),
    index("slug_redirects_to_path_idx").on(table.toPath),
  ],
);

export const contentPublishLog = pgTable(
  "content_publish_log",
  {
    id: idColumn(),
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    revisionId: uuid(),
    fromStatus: text({ enum: CONTENT_STATUSES }).notNull(),
    toStatus: text({ enum: CONTENT_STATUSES }).notNull(),
    actorType: text({ enum: CONTENT_ACTOR_TYPES }).notNull(),
    actorId: text(),
    actorName: text().notNull(),
    reason: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("content_publish_log_from_check", inList(table.fromStatus, CONTENT_STATUSES)),
    check("content_publish_log_to_check", inList(table.toStatus, CONTENT_STATUSES)),
    check("content_publish_log_actor_check", inList(table.actorType, CONTENT_ACTOR_TYPES)),
    index("content_publish_log_item_at_idx").on(table.itemId, table.at.desc()),
    // The daily publish cap counts rows by target status within a window.
    index("content_publish_log_status_at_idx").on(table.toStatus, table.at),
  ],
);

export const contentReviewComments = pgTable(
  "content_review_comments",
  {
    id: idColumn(),
    itemId: uuid()
      .notNull()
      .references(() => contentItems.id, { onDelete: "cascade" }),
    revisionId: uuid().notNull(),
    kind: text({ enum: CONTENT_REVIEW_COMMENT_KINDS }).notNull(),
    comment: text().notNull(),
    authorUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    authorName: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("content_review_comments_kind_check", inList(table.kind, CONTENT_REVIEW_COMMENT_KINDS)),
    index("content_review_comments_item_idx").on(table.itemId, table.createdAt),
  ],
);

export type ContentPerson = typeof contentPeople.$inferSelect;
export type NewContentPerson = typeof contentPeople.$inferInsert;
export type ContentCategory = typeof contentCategories.$inferSelect;
export type NewContentCategory = typeof contentCategories.$inferInsert;
export type ContentTag = typeof contentTags.$inferSelect;
export type NewContentTag = typeof contentTags.$inferInsert;
export type ContentItem = typeof contentItems.$inferSelect;
export type NewContentItem = typeof contentItems.$inferInsert;
export type ContentRevision = typeof contentRevisions.$inferSelect;
export type NewContentRevision = typeof contentRevisions.$inferInsert;
export type ContentAutosave = typeof contentAutosaves.$inferSelect;
export type NewContentAutosave = typeof contentAutosaves.$inferInsert;
export type ContentItemTag = typeof contentItemTags.$inferSelect;
export type ContentLink = typeof contentLinks.$inferSelect;
export type NewContentLink = typeof contentLinks.$inferInsert;
export type ContentEntity = typeof contentEntities.$inferSelect;
export type NewContentEntity = typeof contentEntities.$inferInsert;
export type ContentMediaRef = typeof contentMediaRefs.$inferSelect;
export type ContentCorrection = typeof contentCorrections.$inferSelect;
export type SlugRedirect = typeof slugRedirects.$inferSelect;
export type NewSlugRedirect = typeof slugRedirects.$inferInsert;
export type ContentPublishLogEntry = typeof contentPublishLog.$inferSelect;
export type NewContentPublishLogEntry = typeof contentPublishLog.$inferInsert;
export type ContentReviewComment = typeof contentReviewComments.$inferSelect;
