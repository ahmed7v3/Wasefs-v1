import { Inject, Injectable } from "@nestjs/common";
import {
  contentAutosaves,
  contentCategories,
  contentCorrections,
  contentEntities,
  contentItemTags,
  contentItems,
  contentLinks,
  contentMediaRefs,
  contentPeople,
  contentPublishLog,
  contentReviewComments,
  contentRevisions,
  contentTags,
  countPublishedSince,
  enqueueOutbox,
  mediaAssets,
  publishItemTx,
  purgeItemTx,
  slugRedirects,
  unpublishItemTx,
  type ContentActor,
  type ContentItem,
  type ContentRevision,
  type Database,
  type MediaAssetRecord,
  type NewContentEntity,
  type NewContentLink,
  type NewContentPublishLogEntry,
  type PublishItemResult,
  type PurgeItemResult,
  type Transaction,
} from "@wasfa/db";
import { plainForMatching } from "@wasfa/shared/content";
import {
  CONTENT_PATH_PREFIX,
  CONTENT_TYPES,
  type ContentLocale,
  type ContentType,
} from "@wasfa/shared/content/constants";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  afterCursor,
  escapeLike,
  stamp,
  toPage,
  type Cursor,
  type Page,
} from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";

import type { ContentListQuery } from "@wasfa/shared/schemas/content";

/*
 * The only place the content platform's admin API touches the database. `ContentData` holds every
 * query over an executor (the pool or a transaction); `ContentItemsRepo.transaction` hands the
 * services a `ContentTxData` bound to ONE transaction, so a workflow action, its publish-log row and
 * its outbox event commit together. Services never see Drizzle.
 */

type Executor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

export type MediaRole = "featured" | "body" | "og" | "photo";

export interface PersonRow {
  id: string;
  nameAr: string;
  slug: string;
  role: "author" | "reviewer" | "both";
  active: boolean;
  userId: string | null;
}

export interface CategoryRow {
  id: string;
  nameAr: string;
  requiresMedicalReview: boolean;
  defaultReviewerId: string | null;
}

export interface ItemListRow {
  id: string;
  type: ContentType;
  locale: ContentLocale;
  slug: string;
  status: ContentItem["status"];
  title: string;
  source: ContentItem["source"];
  scheduledAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  wordCount: number;
  publishedRevisionId: string | null;
  nextReviewDue: Date | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryRequiresReview: boolean | null;
  authorId: string | null;
  authorName: string | null;
  authorSlug: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerSlug: string | null;
  quality: unknown;
  cursorAt: string;
}

export type RevisionMetaRow = Omit<ContentRevision, "bodyMd" | "bodyHtml" | "toc" | "minhash">;

export interface MediaRenderRow {
  id: string;
  width: number | null;
  height: number | null;
  altAr: string | null;
  altEn: string | null;
  caption: string | null;
  credit: string | null;
  variants: MediaAssetRecord["variants"];
}

export interface PublishedGlossaryRow {
  slug: string;
  title: string;
  definition: string;
  locale: ContentLocale;
}

export interface PublishedMinhashRow {
  type: ContentType;
  locale: ContentLocale;
  slug: string;
  minhash: Uint8Array;
}

export interface CommentRow {
  id: string;
  kind: "request_changes" | "approve" | "note";
  comment: string;
  authorName: string;
  revisionId: string;
  createdAt: Date;
}

export interface NewRevisionRow {
  itemId: string;
  number: number;
  kind: ContentRevision["kind"];
  title: string;
  excerpt: string;
  definition: string;
  bodyMd: string;
  bodyHtml: string;
  toc: unknown[];
  wordCount: number;
  readingMinutes: number;
  minhash: Buffer;
  quality: unknown[];
  note: string | null;
  createdByUserId: string | null;
  createdByName: string;
  diffStats: { added: number; removed: number };
  parentRevisionId: string | null;
}

export interface NewItemRow {
  type: ContentType;
  locale: ContentLocale;
  translationGroupId: string;
  slug: string;
  title: string;
  categoryId: string | null;
  primaryAuthorId: string | null;
  reviewerId: string | null;
  featuredMediaId: string | null;
  seo: Record<string, unknown>;
  flags: Record<string, unknown>;
  wordCount: number;
  searchText: string;
}

const typeCases = CONTENT_TYPES.map(
  (type) => `when '${type}' then '${CONTENT_PATH_PREFIX[type]}'`,
).join(" ");

/** The public path of a row of `content_items`, computed in SQL exactly like `contentPath`. */
const itemPathSql = sql<string>`(case ${contentItems.locale} when 'en' then '/en' else '' end || case ${contentItems.type} ${sql.raw(typeCases)} end || '/' || ${contentItems.slug})`;

const DAY_MS = 86_400_000;
const nextDay = (iso: string): Date => new Date(Date.parse(`${iso}T00:00:00Z`) + DAY_MS);

export class ContentData {
  constructor(protected readonly exec: Executor) {}

  // -------------------------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------------------------

  async findItem(id: string): Promise<ContentItem | undefined> {
    const [row] = await this.exec.select().from(contentItems).where(eq(contentItems.id, id));
    return row;
  }

  async findRevision(itemId: string, revisionId: string): Promise<ContentRevision | undefined> {
    const [row] = await this.exec
      .select()
      .from(contentRevisions)
      .where(and(eq(contentRevisions.id, revisionId), eq(contentRevisions.itemId, itemId)));
    return row;
  }

  async revisionAuthor(revisionId: string): Promise<string | null> {
    const [row] = await this.exec
      .select({ id: contentRevisions.createdByUserId })
      .from(contentRevisions)
      .where(eq(contentRevisions.id, revisionId));
    return row?.id ?? null;
  }

  listRevisions(itemId: string): Promise<RevisionMetaRow[]> {
    const columns = getRevisionColumns();
    return this.exec
      .select(columns)
      .from(contentRevisions)
      .where(eq(contentRevisions.itemId, itemId))
      .orderBy(desc(contentRevisions.number));
  }

  async nextRevisionNumber(itemId: string): Promise<number> {
    const [row] = await this.exec
      .select({ n: sql<number>`coalesce(max(${contentRevisions.number}), 0)::int` })
      .from(contentRevisions)
      .where(eq(contentRevisions.itemId, itemId));
    return (row?.n ?? 0) + 1;
  }

  async findCategory(id: string): Promise<CategoryRow | undefined> {
    const [row] = await this.exec
      .select({
        id: contentCategories.id,
        nameAr: contentCategories.nameAr,
        requiresMedicalReview: contentCategories.requiresMedicalReview,
        defaultReviewerId: contentCategories.defaultReviewerId,
      })
      .from(contentCategories)
      .where(eq(contentCategories.id, id));
    return row;
  }

  async findPerson(id: string): Promise<PersonRow | undefined> {
    const [row] = await this.exec
      .select({
        id: contentPeople.id,
        nameAr: contentPeople.nameAr,
        slug: contentPeople.slug,
        role: contentPeople.role,
        active: contentPeople.active,
        userId: contentPeople.userId,
      })
      .from(contentPeople)
      .where(eq(contentPeople.id, id));
    return row;
  }

  async isActiveReviewer(userId: string): Promise<boolean> {
    const [row] = await this.exec
      .select({ id: contentPeople.id })
      .from(contentPeople)
      .where(
        and(
          eq(contentPeople.userId, userId),
          eq(contentPeople.active, true),
          inArray(contentPeople.role, ["reviewer", "both"]),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async existingTagIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.exec
      .select({ id: contentTags.id })
      .from(contentTags)
      .where(inArray(contentTags.id, ids));
    return rows.map((row) => row.id);
  }

  tagsOf(itemId: string): Promise<{ id: string; name: string }[]> {
    return this.exec
      .select({ id: contentTags.id, name: contentTags.nameAr })
      .from(contentItemTags)
      .innerJoin(contentTags, eq(contentTags.id, contentItemTags.tagId))
      .where(eq(contentItemTags.itemId, itemId))
      .orderBy(asc(contentTags.nameAr));
  }

  async siblingTranslation(groupId: string, itemId: string) {
    const [row] = await this.exec
      .select({
        id: contentItems.id,
        locale: contentItems.locale,
        slug: contentItems.slug,
        status: contentItems.status,
      })
      .from(contentItems)
      .where(and(eq(contentItems.translationGroupId, groupId), ne(contentItems.id, itemId)))
      .limit(1);
    return row;
  }

  async localeInGroup(groupId: string, locale: ContentLocale): Promise<boolean> {
    const [row] = await this.exec
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(and(eq(contentItems.translationGroupId, groupId), eq(contentItems.locale, locale)))
      .limit(1);
    return row !== undefined;
  }

  async findAutosave(itemId: string, userId: string) {
    const [row] = await this.exec
      .select()
      .from(contentAutosaves)
      .where(and(eq(contentAutosaves.itemId, itemId), eq(contentAutosaves.userId, userId)));
    return row;
  }

  listComments(itemId: string, limit = 50): Promise<CommentRow[]> {
    return this.exec
      .select({
        id: contentReviewComments.id,
        kind: contentReviewComments.kind,
        comment: contentReviewComments.comment,
        authorName: contentReviewComments.authorName,
        revisionId: contentReviewComments.revisionId,
        createdAt: contentReviewComments.createdAt,
      })
      .from(contentReviewComments)
      .where(eq(contentReviewComments.itemId, itemId))
      .orderBy(desc(contentReviewComments.createdAt))
      .limit(limit);
  }

  /** `base`, `base-2`, ... already used in (type, locale): the service picks the first free one. */
  async slugsLike(type: ContentType, locale: ContentLocale, base: string): Promise<string[]> {
    const rows = await this.exec
      .select({ slug: contentItems.slug })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.type, type),
          eq(contentItems.locale, locale),
          or(
            eq(contentItems.slug, base),
            sql`${contentItems.slug} like ${`${escapeLike(base)}-%`}`,
          ),
        ),
      );
    return rows.map((row) => row.slug);
  }

  async slugTaken(
    type: ContentType,
    locale: ContentLocale,
    slug: string,
    excludeId?: string,
  ): Promise<boolean> {
    const [row] = await this.exec
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.type, type),
          eq(contentItems.locale, locale),
          eq(contentItems.slug, slug),
          excludeId === undefined ? undefined : ne(contentItems.id, excludeId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Library images that finished processing, for validation and for the renderer. */
  async readyMedia(ids: string[]): Promise<MediaRenderRow[]> {
    if (ids.length === 0) return [];
    return this.exec
      .select({
        id: mediaAssets.id,
        width: mediaAssets.width,
        height: mediaAssets.height,
        altAr: mediaAssets.altAr,
        altEn: mediaAssets.altEn,
        caption: mediaAssets.caption,
        credit: mediaAssets.credit,
        variants: mediaAssets.variants,
      })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.status, "ready")));
  }

  // -------------------------------------------------------------------------------------------
  // Facts for rendering and the quality gates
  // -------------------------------------------------------------------------------------------

  /** Published glossary entries of a locale, longest term first (longest match wins in auto-link). */
  async glossaryTargets(
    locale: ContentLocale,
    excludeItemId: string | null,
    limit: number,
  ): Promise<PublishedGlossaryRow[]> {
    return this.exec
      .select({
        slug: contentItems.slug,
        title: contentRevisions.title,
        definition: contentRevisions.definition,
        locale: contentItems.locale,
      })
      .from(contentItems)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItems.publishedRevisionId))
      .where(
        and(
          eq(contentItems.type, "glossary"),
          eq(contentItems.locale, locale),
          excludeItemId === null ? undefined : ne(contentItems.id, excludeItemId),
        ),
      )
      .orderBy(desc(sql`length(${contentRevisions.title})`), asc(contentItems.slug))
      .limit(limit);
  }

  async findPublishedGlossary(
    locale: ContentLocale,
    slug: string,
  ): Promise<PublishedGlossaryRow | undefined> {
    const [row] = await this.exec
      .select({
        slug: contentItems.slug,
        title: contentRevisions.title,
        definition: contentRevisions.definition,
        locale: contentItems.locale,
      })
      .from(contentItems)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItems.publishedRevisionId))
      .where(
        and(
          eq(contentItems.type, "glossary"),
          eq(contentItems.locale, locale),
          eq(contentItems.slug, slug),
        ),
      );
    return row;
  }

  /** MinHash signatures of the published revisions of a locale, outside the item's own translation group. */
  async publishedMinhashes(
    locale: ContentLocale,
    excludeGroupId: string | null,
    limit: number,
  ): Promise<PublishedMinhashRow[]> {
    const rows = await this.exec
      .select({
        type: contentItems.type,
        locale: contentItems.locale,
        slug: contentItems.slug,
        minhash: contentRevisions.minhash,
      })
      .from(contentItems)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItems.publishedRevisionId))
      .where(
        and(
          eq(contentItems.locale, locale),
          excludeGroupId === null ? undefined : ne(contentItems.translationGroupId, excludeGroupId),
          sql`${contentRevisions.minhash} is not null`,
        ),
      )
      .limit(limit);
    return rows.flatMap((row) => (row.minhash ? [{ ...row, minhash: row.minhash }] : []));
  }

  async similarTitleExists(input: {
    type: ContentType;
    locale: ContentLocale;
    title: string;
    threshold: number;
    excludeItemId: string | null;
  }): Promise<boolean> {
    const [row] = await this.exec
      .select({ id: contentItems.id })
      .from(contentItems)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItems.publishedRevisionId))
      .where(
        and(
          eq(contentItems.type, input.type),
          eq(contentItems.locale, input.locale),
          input.excludeItemId === null ? undefined : ne(contentItems.id, input.excludeItemId),
          sql`similarity(${contentRevisions.title}, ${input.title}) >= ${input.threshold}`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Meta descriptions of the other published items of a locale, normalised for an exact comparison. */
  async publishedDescriptions(
    locale: ContentLocale,
    excludeItemId: string | null,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.exec
      .select({ description: sql<string>`${contentItems.seo}->>'description'` })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.locale, locale),
          sql`${contentItems.publishedRevisionId} is not null`,
          excludeItemId === null ? undefined : ne(contentItems.id, excludeItemId),
          sql`coalesce(${contentItems.seo}->>'description', '') <> ''`,
        ),
      )
      .limit(limit);
    return rows.map((row) => plainForMatching(row.description));
  }

  /**
   * For site-relative content paths: which are the path of a published item (path -> item id) and
   * which are the source of a redirect. A path in neither is a broken link.
   */
  async internalPathState(
    paths: string[],
  ): Promise<{ items: Map<string, string>; redirected: Set<string> }> {
    if (paths.length === 0) return { items: new Map(), redirected: new Set() };
    const [items, redirects] = await Promise.all([
      this.exec
        .select({ id: contentItems.id, path: itemPathSql })
        .from(contentItems)
        .where(
          and(sql`${contentItems.publishedRevisionId} is not null`, inArray(itemPathSql, paths)),
        ),
      this.exec
        .select({ path: slugRedirects.fromPath })
        .from(slugRedirects)
        .where(inArray(slugRedirects.fromPath, paths)),
    ]);
    return {
      items: new Map(items.map((row) => [row.path, row.id])),
      redirected: new Set(redirects.map((row) => row.path)),
    };
  }

  // -------------------------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------------------------

  /** `limit + 1` rows, most recently updated first. */
  list(
    query: ContentListQuery,
    cursor: Cursor | undefined,
    limit: number,
    now: Date,
  ): Promise<ItemListRow[]> {
    const author = alias(contentPeople, "author");
    const reviewer = alias(contentPeople, "reviewer");
    const failing = sql`exists (select 1 from jsonb_array_elements(${contentRevisions.quality}) g where g->>'ok' = 'false' and g->>'level' in ('block','warn'))`;
    const conditions: (SQL | undefined)[] = [
      query.type ? eq(contentItems.type, query.type) : undefined,
      query.status ? eq(contentItems.status, query.status) : undefined,
      query.locale ? eq(contentItems.locale, query.locale) : undefined,
      query.categoryId ? eq(contentItems.categoryId, query.categoryId) : undefined,
      query.authorId ? eq(contentItems.primaryAuthorId, query.authorId) : undefined,
      query.reviewerId ? eq(contentItems.reviewerId, query.reviewerId) : undefined,
      query.source ? eq(contentItems.source, query.source) : undefined,
      query.apiKeyId ? eq(contentItems.apiKeyId, query.apiKeyId) : undefined,
      query.from ? gte(contentItems.createdAt, new Date(`${query.from}T00:00:00Z`)) : undefined,
      query.to ? lt(contentItems.createdAt, nextDay(query.to)) : undefined,
      query.scheduledFrom
        ? gte(contentItems.scheduledAt, new Date(`${query.scheduledFrom}T00:00:00Z`))
        : undefined,
      query.scheduledTo ? lt(contentItems.scheduledAt, nextDay(query.scheduledTo)) : undefined,
      query.publishedFrom
        ? gte(contentItems.publishedAt, new Date(`${query.publishedFrom}T00:00:00Z`))
        : undefined,
      query.publishedTo ? lt(contentItems.publishedAt, nextDay(query.publishedTo)) : undefined,
      query.live === undefined
        ? undefined
        : query.live
          ? sql`${contentItems.publishedRevisionId} is not null`
          : sql`${contentItems.publishedRevisionId} is null`,
      query.reviewOverdue
        ? and(
            sql`${contentItems.publishedRevisionId} is not null`,
            lt(contentItems.nextReviewDue, now),
          )
        : undefined,
      query.hasIssues === undefined ? undefined : query.hasIssues ? failing : sql`not ${failing}`,
      cursor ? afterCursor(contentItems.updatedAt, contentItems.id, cursor, "uuid") : undefined,
    ];
    if (query.q !== undefined) {
      const normalised = plainForMatching(query.q);
      conditions.push(
        sql`(${contentItems.searchTsv} @@ plainto_tsquery('simple', ${normalised}) or ${contentItems.title} % ${query.q} or ${contentItems.slug} ilike ${`%${escapeLike(query.q.toLowerCase())}%`})`,
      );
    }
    return this.exec
      .select({
        id: contentItems.id,
        type: contentItems.type,
        locale: contentItems.locale,
        slug: contentItems.slug,
        status: contentItems.status,
        title: contentItems.title,
        source: contentItems.source,
        scheduledAt: contentItems.scheduledAt,
        publishedAt: contentItems.publishedAt,
        updatedAt: contentItems.updatedAt,
        wordCount: contentItems.wordCount,
        publishedRevisionId: contentItems.publishedRevisionId,
        nextReviewDue: contentItems.nextReviewDue,
        categoryId: contentCategories.id,
        categoryName: contentCategories.nameAr,
        categoryRequiresReview: contentCategories.requiresMedicalReview,
        authorId: author.id,
        authorName: author.nameAr,
        authorSlug: author.slug,
        reviewerId: reviewer.id,
        reviewerName: reviewer.nameAr,
        reviewerSlug: reviewer.slug,
        quality: contentRevisions.quality,
        cursorAt: stamp(contentItems.updatedAt),
      })
      .from(contentItems)
      .leftJoin(contentCategories, eq(contentCategories.id, contentItems.categoryId))
      .leftJoin(author, eq(author.id, contentItems.primaryAuthorId))
      .leftJoin(reviewer, eq(reviewer.id, contentItems.reviewerId))
      .leftJoin(contentRevisions, eq(contentRevisions.id, contentItems.currentRevisionId))
      .where(and(...conditions))
      .orderBy(desc(contentItems.updatedAt), desc(contentItems.id))
      .limit(limit + 1);
  }

  // -------------------------------------------------------------------------------------------
  // Writes (callers run them inside `transaction` when more than one must commit together)
  // -------------------------------------------------------------------------------------------

  async insertItem(row: NewItemRow, createdAt: Date): Promise<ContentItem> {
    const [saved] = await this.exec
      .insert(contentItems)
      .values({
        ...row,
        status: "draft",
        source: "editor",
        lockVersion: 0,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    if (!saved) throw new Error("content item insert returned no row");
    return saved;
  }

  async insertRevision(row: NewRevisionRow, createdAt: Date): Promise<ContentRevision> {
    const [saved] = await this.exec
      .insert(contentRevisions)
      .values({ ...row, createdAt })
      .returning();
    if (!saved) throw new Error("content revision insert returned no row");
    return saved;
  }

  async updateItem(id: string, patch: Partial<typeof contentItems.$inferInsert>): Promise<void> {
    await this.exec.update(contentItems).set(patch).where(eq(contentItems.id, id));
  }

  /** Derived columns may be recomputed (the immutability trigger only guards the authored ones). */
  async updateRevisionQuality(revisionId: string, quality: unknown[]): Promise<void> {
    await this.exec
      .update(contentRevisions)
      .set({ quality })
      .where(eq(contentRevisions.id, revisionId));
  }

  async setItemTags(itemId: string, tagIds: string[]): Promise<void> {
    await this.exec.delete(contentItemTags).where(eq(contentItemTags.itemId, itemId));
    if (tagIds.length > 0) {
      await this.exec.insert(contentItemTags).values(tagIds.map((tagId) => ({ itemId, tagId })));
    }
  }

  async replaceLinks(itemId: string, rows: Omit<NewContentLink, "itemId" | "id">[]): Promise<void> {
    await this.exec.delete(contentLinks).where(eq(contentLinks.itemId, itemId));
    if (rows.length > 0) {
      await this.exec.insert(contentLinks).values(rows.map((row) => ({ ...row, itemId })));
    }
  }

  async replaceEntities(
    itemId: string,
    rows: Omit<NewContentEntity, "itemId" | "id">[],
  ): Promise<void> {
    await this.exec.delete(contentEntities).where(eq(contentEntities.itemId, itemId));
    if (rows.length > 0) {
      await this.exec.insert(contentEntities).values(rows.map((row) => ({ ...row, itemId })));
    }
  }

  /** Replaces the item's references for the given roles only (a meta edit refreshes featured/og, not body). */
  async replaceMediaRefs(
    itemId: string,
    roles: MediaRole[],
    rows: { mediaId: string; role: MediaRole }[],
  ): Promise<void> {
    await this.exec
      .delete(contentMediaRefs)
      .where(and(eq(contentMediaRefs.itemId, itemId), inArray(contentMediaRefs.role, roles)));
    if (rows.length > 0) {
      await this.exec
        .insert(contentMediaRefs)
        .values(rows.map((row) => ({ ...row, itemId })))
        .onConflictDoNothing();
    }
  }

  async upsertAutosave(input: {
    itemId: string;
    userId: string;
    baseRevisionId: string;
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await this.exec
      .insert(contentAutosaves)
      .values({
        itemId: input.itemId,
        userId: input.userId,
        baseRevisionId: input.baseRevisionId,
        payload: input.payload,
        savedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [contentAutosaves.itemId, contentAutosaves.userId],
        set: {
          baseRevisionId: input.baseRevisionId,
          payload: input.payload,
          savedAt: input.now,
        },
      });
  }

  async deleteAutosave(itemId: string, userId: string): Promise<void> {
    await this.exec
      .delete(contentAutosaves)
      .where(and(eq(contentAutosaves.itemId, itemId), eq(contentAutosaves.userId, userId)));
  }

  async insertPublishLog(row: NewContentPublishLogEntry): Promise<void> {
    await this.exec.insert(contentPublishLog).values(row);
  }

  async insertReviewComment(row: {
    itemId: string;
    revisionId: string;
    kind: "request_changes" | "approve" | "note";
    comment: string;
    authorUserId: string;
    authorName: string;
    now: Date;
  }): Promise<void> {
    await this.exec.insert(contentReviewComments).values({ ...row, createdAt: row.now });
  }

  async insertCorrection(row: {
    itemId: string;
    summary: string;
    createdBy: string;
    now: Date;
  }): Promise<void> {
    await this.exec.insert(contentCorrections).values({
      itemId: row.itemId,
      summary: row.summary,
      createdBy: row.createdBy,
      createdAt: row.now,
    });
  }

  /**
   * Records `fromPath -> toPath` keeping redirects one hop deep: a redirect that already pointed at
   * `fromPath` is repointed at `toPath`, and a redirect away from `toPath` is dropped (the content
   * lives there now), so a rename back never leaves a loop.
   */
  async upsertRedirect(input: {
    fromPath: string;
    toPath: string;
    reason: "slug_changed" | "archived";
    createdBy: string;
    now: Date;
  }): Promise<void> {
    await this.exec.delete(slugRedirects).where(eq(slugRedirects.fromPath, input.toPath));
    await this.exec
      .update(slugRedirects)
      .set({ toPath: input.toPath, updatedAt: input.now })
      .where(eq(slugRedirects.toPath, input.fromPath));
    await this.exec
      .insert(slugRedirects)
      .values({
        fromPath: input.fromPath,
        toPath: input.toPath,
        reason: input.reason,
        createdBy: input.createdBy,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoUpdate({
        target: slugRedirects.fromPath,
        set: { toPath: input.toPath, reason: input.reason, updatedAt: input.now },
      });
  }

  /** Drops the `archived` redirect away from a path (unarchive); true when one existed. */
  async deleteArchivedRedirect(fromPath: string): Promise<boolean> {
    const rows = await this.exec
      .delete(slugRedirects)
      .where(and(eq(slugRedirects.fromPath, fromPath), eq(slugRedirects.reason, "archived")))
      .returning({ id: slugRedirects.id });
    return rows.length > 0;
  }
}

/** All queries of `ContentData`, bound to one transaction, plus the helpers that need its handle. */
export class ContentTxData extends ContentData {
  constructor(private readonly tx: Transaction) {
    super(tx);
  }

  /** `FOR UPDATE` on the item: workflow actions, edits and publish serialise on it. */
  async lockItem(id: string): Promise<ContentItem | undefined> {
    const [row] = await this.tx
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, id))
      .limit(1)
      .for("update");
    return row;
  }

  /** Serialises the daily-cap check across items (released at commit). */
  async lockPublishCap(): Promise<void> {
    await this.tx.execute(sql`select pg_advisory_xact_lock(hashtext('content.publish-cap'))`);
  }

  countPublishedSince(since: Date): Promise<number> {
    return countPublishedSince(this.tx, since);
  }

  publish(input: { itemId: string; actor: ContentActor; now: Date }): Promise<PublishItemResult> {
    return publishItemTx(this.tx, input);
  }

  unpublish(input: { itemId: string; actor: ContentActor; now: Date }): Promise<void> {
    return unpublishItemTx(this.tx, input);
  }

  /** Owner-only permanent delete of the item, its revisions and everything hanging off it (not media files). */
  purge(input: { itemId: string; now: Date }): Promise<PurgeItemResult> {
    return purgeItemTx(this.tx, input);
  }

  emit(
    payload: {
      itemId: string | null;
      kind: "updated" | "archived" | "moved" | "redirects";
      paths: string[];
      oldPaths: string[];
    },
    idempotencyKey: string,
  ): Promise<void> {
    return enqueueOutbox(this.tx, "content.changed", payload, idempotencyKey);
  }
}

@Injectable()
export class ContentItemsRepo extends ContentData {
  constructor(@Inject(DB) private readonly handle: DbHandle) {
    super(handle.db);
  }

  transaction<T>(fn: (data: ContentTxData) => Promise<T>): Promise<T> {
    return this.handle.db.transaction((tx) => fn(new ContentTxData(tx)));
  }
}

export function pageOf(rows: readonly ItemListRow[], limit: number): Page<ItemListRow> {
  return toPage(rows, limit, (row) => ({ at: row.cursorAt, key: row.id }));
}

function getRevisionColumns() {
  // Everything but the heavy columns (markdown, html, toc, signature): the history list never needs them.
  return {
    id: contentRevisions.id,
    itemId: contentRevisions.itemId,
    number: contentRevisions.number,
    kind: contentRevisions.kind,
    title: contentRevisions.title,
    excerpt: contentRevisions.excerpt,
    definition: contentRevisions.definition,
    wordCount: contentRevisions.wordCount,
    readingMinutes: contentRevisions.readingMinutes,
    quality: contentRevisions.quality,
    note: contentRevisions.note,
    createdByUserId: contentRevisions.createdByUserId,
    createdByApiKeyId: contentRevisions.createdByApiKeyId,
    createdByName: contentRevisions.createdByName,
    diffStats: contentRevisions.diffStats,
    parentRevisionId: contentRevisions.parentRevisionId,
    createdAt: contentRevisions.createdAt,
  };
}
