import { Inject, Injectable } from "@nestjs/common";
import {
  contentCategories,
  contentCorrections,
  contentEntities,
  contentItemTags,
  contentItems,
  contentPeople,
  contentRevisions,
  contentTags,
  mediaAssets,
  slugRedirects,
} from "@wasfa/db";
import { contentPath } from "@wasfa/shared/content";
import { contentSeoSchema } from "@wasfa/shared/schemas/content";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type {
  CardParts,
  CategoryRow,
  ItemParts,
  ItemRow,
  ListFilter,
  MediaRow,
  PersonRow,
  RelatedCandidate,
  RevisionRow,
  SitemapItemRow,
  TagRow,
  TaxonCount,
} from "./public-content.types.js";
import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

/** Everything the service needs from the database. The service depends on this, so tests fake it. */
export interface PublicContentStore {
  findItem(type: ContentType, locale: ContentLocale, slug: string): Promise<ItemRow | undefined>;
  findItemById(id: string): Promise<ItemRow | undefined>;
  redirectFor(fromPath: string): Promise<string | null>;
  itemParts(item: ItemRow, revisionId: string): Promise<ItemParts | undefined>;
  cardsByIds(ids: string[]): Promise<CardParts[]>;
  relatedCandidates(item: ItemRow, tagIds: string[]): Promise<RelatedCandidate[]>;
  list(filter: ListFilter): Promise<{ rows: CardParts[]; total: number }>;
  findCategory(slug: string, locale: ContentLocale): Promise<CategoryRow | undefined>;
  findTag(slug: string, locale: ContentLocale): Promise<TagRow | undefined>;
  findAuthor(slug: string): Promise<{ person: PersonRow; photo: MediaRow | null } | undefined>;
  countPublished(
    locale: ContentLocale,
    by: { categoryId?: string; tagId?: string; authorId?: string },
  ): Promise<number>;
  listCategories(locale: ContentLocale, minItems: number): Promise<TaxonCount<CategoryRow>[]>;
  listTags(locale: ContentLocale, minItems: number): Promise<TaxonCount<TagRow>[]>;
  listAuthors(locale: ContentLocale, minItems: number): Promise<TaxonCount<PersonRow>[]>;
  glossaryIndex(
    locale: ContentLocale,
  ): Promise<{ slug: string; title: string; definition: string }[]>;
  redirects(cap: number): Promise<{ fromPath: string; toPath: string }[]>;
  gonePaths(cap: number): Promise<string[]>;
  sitemapItems(
    type: ContentType,
    locale: ContentLocale,
    offset: number,
    limit: number,
  ): Promise<SitemapItemRow[]>;
  publishedTwins(
    groupIds: string[],
  ): Promise<Pick<ItemRow, "translationGroupId" | "type" | "locale" | "slug">[]>;
}

function pick<T extends Record<string, unknown>, K extends keyof T>(
  columns: T,
  keys: readonly K[],
): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, columns[key]])) as Pick<T, K>;
}

const itemCols = pick(getTableColumns(contentItems), [
  "id",
  "type",
  "locale",
  "translationGroupId",
  "slug",
  "status",
  "categoryId",
  "primaryAuthorId",
  "reviewerId",
  "featuredMediaId",
  "seo",
  "flags",
  "currentRevisionId",
  "reviewedRevisionId",
  "publishedRevisionId",
  "reviewedAt",
  "publishedAt",
  "firstPublishedAt",
  "contentUpdatedAt",
  "updatedAt",
  "archivedRedirectTo",
] as const);
const revisionCols = pick(getTableColumns(contentRevisions), [
  "id",
  "title",
  "excerpt",
  "definition",
  "bodyHtml",
  "toc",
  "wordCount",
  "readingMinutes",
  "createdAt",
] as const);
const personCols = pick(getTableColumns(contentPeople), [
  "id",
  "slug",
  "nameAr",
  "nameEn",
  "credentialsAr",
  "credentialsEn",
  "licenceNumber",
  "showLicence",
  "bioMdAr",
  "bioMdEn",
  "sameAs",
  "photoMediaId",
  "active",
  "updatedAt",
] as const);
const categoryCols = pick(getTableColumns(contentCategories), [
  "id",
  "slugAr",
  "slugEn",
  "nameAr",
  "nameEn",
  "descriptionAr",
  "descriptionEn",
  "requiresMedicalReview",
  "seoTitleAr",
  "seoDescriptionAr",
  "seoTitleEn",
  "seoDescriptionEn",
  "updatedAt",
] as const);
const tagCols = pick(getTableColumns(contentTags), [
  "id",
  "slugAr",
  "slugEn",
  "nameAr",
  "nameEn",
  "descriptionAr",
  "descriptionEn",
  "updatedAt",
] as const);
const mediaCols = pick(getTableColumns(mediaAssets), [
  "id",
  "status",
  "width",
  "height",
  "focalX",
  "focalY",
  "altAr",
  "altEn",
  "blurDataUrl",
  "variants",
  "caption",
  "credit",
] as const);

type PersonWithPhoto = PersonRow;

const CHUNK = 1000;
const CANDIDATE_LIMIT = 12;

/** Published = the item has a live revision (CONTENT-PLATFORM §11.1). */
const isLive = isNotNull(contentItems.publishedRevisionId);
const notNoindex = sql`coalesce(${contentItems.seo}->>'robots', 'index') <> 'noindex'`;

/**
 * READ-ONLY queries of the public content API. Platform data with no owner, so no `scopedRepo`; the only
 * route to unpublished rows is `findItemById` + `itemParts`, which the service reaches solely through a
 * verified preview token.
 */
@Injectable()
export class PublicContentRepo implements PublicContentStore {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  async findItem(type: ContentType, locale: ContentLocale, slug: string) {
    const [row] = await this.db
      .select(itemCols)
      .from(contentItems)
      .where(
        and(
          eq(contentItems.type, type),
          eq(contentItems.locale, locale),
          eq(contentItems.slug, slug),
        ),
      );
    return row;
  }

  async findItemById(id: string) {
    const [row] = await this.db.select(itemCols).from(contentItems).where(eq(contentItems.id, id));
    return row;
  }

  async redirectFor(fromPath: string): Promise<string | null> {
    const [row] = await this.db
      .select({ toPath: slugRedirects.toPath })
      .from(slugRedirects)
      .where(eq(slugRedirects.fromPath, fromPath));
    return row?.toPath ?? null;
  }

  private async mediaMap(ids: (string | null | undefined)[]): Promise<Map<string, MediaRow>> {
    const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
    if (wanted.length === 0) return new Map();
    const rows = await this.db
      .select(mediaCols)
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, wanted));
    return new Map(rows.map((row) => [row.id, row]));
  }

  private async peopleMap(ids: (string | null)[]): Promise<Map<string, PersonWithPhoto>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await this.db
      .select(personCols)
      .from(contentPeople)
      .where(inArray(contentPeople.id, wanted));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async itemParts(item: ItemRow, revisionId: string): Promise<ItemParts | undefined> {
    const [revisions, categories, people, tags, corrections, twins] = await Promise.all([
      this.db
        .select(revisionCols)
        .from(contentRevisions)
        .where(and(eq(contentRevisions.id, revisionId), eq(contentRevisions.itemId, item.id))),
      item.categoryId === null
        ? Promise.resolve([])
        : this.db
            .select(categoryCols)
            .from(contentCategories)
            .where(eq(contentCategories.id, item.categoryId)),
      this.peopleMap([item.primaryAuthorId, item.reviewerId]),
      this.db
        .select(tagCols)
        .from(contentItemTags)
        .innerJoin(contentTags, eq(contentTags.id, contentItemTags.tagId))
        .where(eq(contentItemTags.itemId, item.id))
        .orderBy(asc(contentTags.nameAr)),
      this.db
        .select({ summary: contentCorrections.summary, createdAt: contentCorrections.createdAt })
        .from(contentCorrections)
        .where(eq(contentCorrections.itemId, item.id))
        .orderBy(desc(contentCorrections.createdAt)),
      this.db
        .select({
          type: contentItems.type,
          locale: contentItems.locale,
          slug: contentItems.slug,
          publishedRevisionId: contentItems.publishedRevisionId,
        })
        .from(contentItems)
        .where(
          and(
            eq(contentItems.translationGroupId, item.translationGroupId),
            ne(contentItems.id, item.id),
          ),
        ),
    ]);
    const revision = revisions[0];
    if (revision === undefined) return undefined;

    const author =
      item.primaryAuthorId === null ? null : (people.get(item.primaryAuthorId) ?? null);
    const reviewer = item.reviewerId === null ? null : (people.get(item.reviewerId) ?? null);
    const seo = contentSeoSchema.safeParse(item.seo);
    const ogId = seo.success ? seo.data.ogImageMediaId : null;
    const media = await this.mediaMap([
      item.featuredMediaId,
      author?.photoMediaId,
      reviewer?.photoMediaId,
      ogId,
    ]);
    const mediaOf = (id: string | null | undefined) =>
      typeof id === "string" ? (media.get(id) ?? null) : null;

    return {
      item,
      revision,
      category: categories[0] ?? null,
      author,
      image: mediaOf(item.featuredMediaId),
      tags,
      authorPhoto: mediaOf(author?.photoMediaId),
      reviewer,
      reviewerPhoto: mediaOf(reviewer?.photoMediaId),
      corrections,
      ogImage: mediaOf(ogId),
      twins,
    };
  }

  /** Cards for published items only, in the order of `ids`; unknown or unpublished ids are dropped. */
  async cardsByIds(ids: string[]): Promise<CardParts[]> {
    if (ids.length === 0) return [];
    const items = await this.db
      .select(itemCols)
      .from(contentItems)
      .where(and(inArray(contentItems.id, ids), isLive));
    const byId = new Map((await this.hydrate(items)).map((card) => [card.item.id, card]));
    return ids.flatMap((id) => {
      const card = byId.get(id);
      return card === undefined ? [] : [card];
    });
  }

  /** Attaches the PUBLISHED revision, category, author and featured image to published item rows. */
  private async hydrate(items: ItemRow[]): Promise<CardParts[]> {
    if (items.length === 0) return [];
    const revisionIds = items.flatMap((item) =>
      item.publishedRevisionId === null ? [] : [item.publishedRevisionId],
    );
    const categoryIds = [
      ...new Set(items.flatMap((item) => (item.categoryId ? [item.categoryId] : []))),
    ];
    const [revisions, categories, people, media] = await Promise.all([
      this.db
        .select(revisionCols)
        .from(contentRevisions)
        .where(inArray(contentRevisions.id, revisionIds)),
      categoryIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select(categoryCols)
            .from(contentCategories)
            .where(inArray(contentCategories.id, categoryIds)),
      this.peopleMap(items.map((item) => item.primaryAuthorId)),
      this.mediaMap(items.map((item) => item.featuredMediaId)),
    ]);
    const revisionById = new Map(revisions.map((row) => [row.id, row]));
    const categoryById = new Map(categories.map((row) => [row.id, row]));
    return items.flatMap((item) => {
      const revision =
        item.publishedRevisionId === null ? undefined : revisionById.get(item.publishedRevisionId);
      if (revision === undefined) return [];
      return [
        {
          item,
          revision,
          category: item.categoryId === null ? null : (categoryById.get(item.categoryId) ?? null),
          author: item.primaryAuthorId === null ? null : (people.get(item.primaryAuthorId) ?? null),
          image: item.featuredMediaId === null ? null : (media.get(item.featuredMediaId) ?? null),
        },
      ];
    });
  }

  async relatedCandidates(item: ItemRow, tagIds: string[]): Promise<RelatedCandidate[]> {
    const sameCategory =
      item.categoryId === null
        ? sql<boolean>`false`
        : sql<boolean>`(${contentItems.categoryId} = ${item.categoryId})`;
    const sharedTags =
      tagIds.length === 0
        ? sql<number>`0`
        : sql<number>`(select count(*)::int from ${contentItemTags} where ${contentItemTags.itemId} = "content_items"."id" and ${inArray(contentItemTags.tagId, tagIds)})`;
    const sharedEntities = sql<number>`(select count(*)::int from ${contentEntities} e2 join ${contentEntities} e1 on e1.kind = e2.kind and e1.slug = e2.slug where e2.item_id = "content_items"."id" and e1.item_id = ${item.id})`;
    const rows = await this.db
      .select({
        id: contentItems.id,
        publishedAt: contentItems.publishedAt,
        sameCategory,
        sharedTags,
        sharedEntities,
      })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.type, item.type),
          eq(contentItems.locale, item.locale),
          ne(contentItems.id, item.id),
          isLive,
        ),
      )
      .orderBy(
        desc(
          sql`(3 * ${sharedEntities} + case when ${sameCategory} then 2 else 0 end + ${sharedTags})`,
        ),
        desc(contentItems.publishedAt),
        desc(contentItems.id),
      )
      .limit(CANDIDATE_LIMIT);
    return rows;
  }

  async list(filter: ListFilter) {
    const conditions: SQL[] = [
      eq(contentItems.type, filter.type),
      eq(contentItems.locale, filter.locale),
      isLive,
    ];
    if (filter.categoryId !== undefined)
      conditions.push(eq(contentItems.categoryId, filter.categoryId));
    if (filter.authorId !== undefined) {
      conditions.push(eq(contentItems.primaryAuthorId, filter.authorId));
    }
    if (filter.tagId !== undefined) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(contentItemTags)
            .where(
              and(
                eq(contentItemTags.itemId, contentItems.id),
                eq(contentItemTags.tagId, filter.tagId),
              ),
            ),
        ),
      );
    }
    const where = and(...conditions);
    const [items, total] = await Promise.all([
      this.db
        .select(itemCols)
        .from(contentItems)
        .where(where)
        .orderBy(desc(contentItems.publishedAt), desc(contentItems.id))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize),
      this.db.$count(contentItems, where),
    ]);
    return { rows: await this.hydrate(items), total };
  }

  async findCategory(slug: string, locale: ContentLocale) {
    const [row] = await this.db
      .select(categoryCols)
      .from(contentCategories)
      .where(eq(locale === "en" ? contentCategories.slugEn : contentCategories.slugAr, slug));
    return row;
  }

  async findTag(slug: string, locale: ContentLocale) {
    const [row] = await this.db
      .select(tagCols)
      .from(contentTags)
      .where(eq(locale === "en" ? contentTags.slugEn : contentTags.slugAr, slug));
    return row;
  }

  async findAuthor(slug: string) {
    const [person] = await this.db
      .select(personCols)
      .from(contentPeople)
      .where(and(eq(contentPeople.slug, slug), eq(contentPeople.active, true)));
    if (person === undefined) return undefined;
    const media = await this.mediaMap([person.photoMediaId]);
    return { person, photo: person.photoMediaId ? (media.get(person.photoMediaId) ?? null) : null };
  }

  async countPublished(
    locale: ContentLocale,
    by: { categoryId?: string; tagId?: string; authorId?: string },
  ): Promise<number> {
    const conditions: SQL[] = [eq(contentItems.locale, locale), isLive];
    if (by.categoryId !== undefined) conditions.push(eq(contentItems.categoryId, by.categoryId));
    if (by.authorId !== undefined) conditions.push(eq(contentItems.primaryAuthorId, by.authorId));
    if (by.tagId !== undefined) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(contentItemTags)
            .where(
              and(eq(contentItemTags.itemId, contentItems.id), eq(contentItemTags.tagId, by.tagId)),
            ),
        ),
      );
    }
    return this.db.$count(contentItems, and(...conditions));
  }

  async listCategories(locale: ContentLocale, minItems: number) {
    const itemCount = count(contentItems.id);
    const rows = await this.db
      .select({ row: categoryCols, itemCount, last: max(contentItems.contentUpdatedAt) })
      .from(contentCategories)
      .leftJoin(
        contentItems,
        and(
          eq(contentItems.categoryId, contentCategories.id),
          eq(contentItems.locale, locale),
          isLive,
        ),
      )
      .where(locale === "en" ? isNotNull(contentCategories.slugEn) : undefined)
      .groupBy(contentCategories.id)
      .having(sql`${itemCount} >= ${minItems}`)
      .orderBy(asc(contentCategories.sort), asc(contentCategories.nameAr));
    return rows.map((r) => ({ row: r.row, itemCount: r.itemCount, lastItemUpdatedAt: r.last }));
  }

  async listTags(locale: ContentLocale, minItems: number) {
    const itemCount = count(contentItems.id);
    const rows = await this.db
      .select({ row: tagCols, itemCount, last: max(contentItems.contentUpdatedAt) })
      .from(contentTags)
      .leftJoin(contentItemTags, eq(contentItemTags.tagId, contentTags.id))
      .leftJoin(
        contentItems,
        and(eq(contentItems.id, contentItemTags.itemId), eq(contentItems.locale, locale), isLive),
      )
      .where(isNotNull(locale === "en" ? contentTags.slugEn : contentTags.slugAr))
      .groupBy(contentTags.id)
      .having(sql`${itemCount} >= ${minItems}`)
      .orderBy(asc(contentTags.nameAr));
    return rows.map((r) => ({ row: r.row, itemCount: r.itemCount, lastItemUpdatedAt: r.last }));
  }

  async listAuthors(locale: ContentLocale, minItems: number) {
    const itemCount = count(contentItems.id);
    const rows = await this.db
      .select({ row: personCols, itemCount, last: max(contentItems.contentUpdatedAt) })
      .from(contentPeople)
      .leftJoin(
        contentItems,
        and(
          eq(contentItems.primaryAuthorId, contentPeople.id),
          eq(contentItems.locale, locale),
          isLive,
        ),
      )
      .where(eq(contentPeople.active, true))
      .groupBy(contentPeople.id)
      .having(sql`${itemCount} >= ${minItems}`)
      .orderBy(asc(contentPeople.nameAr));
    return rows.map((r) => ({ row: r.row, itemCount: r.itemCount, lastItemUpdatedAt: r.last }));
  }

  async glossaryIndex(locale: ContentLocale) {
    return this.db
      .select({
        slug: contentItems.slug,
        title: contentRevisions.title,
        definition: contentRevisions.definition,
      })
      .from(contentItems)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItems.publishedRevisionId))
      .where(and(eq(contentItems.type, "glossary"), eq(contentItems.locale, locale), isLive))
      .orderBy(asc(contentRevisions.title), asc(contentItems.id));
  }

  async redirects(cap: number) {
    return this.db
      .select({ fromPath: slugRedirects.fromPath, toPath: slugRedirects.toPath })
      .from(slugRedirects)
      .orderBy(asc(slugRedirects.fromPath))
      .limit(cap);
  }

  /** Paths of items archived after having been public, with no redirect covering them (those answer 410). */
  async gonePaths(cap: number): Promise<string[]> {
    const rows = await this.db
      .select({ type: contentItems.type, locale: contentItems.locale, slug: contentItems.slug })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.status, "archived"),
          isNotNull(contentItems.firstPublishedAt),
          isNull(contentItems.archivedRedirectTo),
          isNull(contentItems.publishedRevisionId),
        ),
      )
      .orderBy(asc(contentItems.id))
      .limit(cap);
    const paths = rows.map((row) => contentPath(row.type, row.locale, row.slug));
    const redirected = new Set<string>();
    for (let start = 0; start < paths.length; start += CHUNK) {
      const found = await this.db
        .select({ fromPath: slugRedirects.fromPath })
        .from(slugRedirects)
        .where(inArray(slugRedirects.fromPath, paths.slice(start, start + CHUNK)));
      for (const row of found) redirected.add(row.fromPath);
    }
    return paths.filter((path) => !redirected.has(path));
  }

  async sitemapItems(type: ContentType, locale: ContentLocale, offset: number, limit: number) {
    const rows = await this.db
      .select({
        item: pick(getTableColumns(contentItems), [
          "id",
          "type",
          "locale",
          "slug",
          "translationGroupId",
          "contentUpdatedAt",
          "publishedAt",
          "updatedAt",
        ] as const),
        image: mediaCols,
      })
      .from(contentItems)
      .leftJoin(
        mediaAssets,
        and(eq(mediaAssets.id, contentItems.featuredMediaId), eq(mediaAssets.status, "ready")),
      )
      .where(and(eq(contentItems.type, type), eq(contentItems.locale, locale), isLive, notNoindex))
      .orderBy(asc(contentItems.publishedAt), asc(contentItems.id))
      .offset(offset)
      .limit(limit);
    // A left join yields an all-null object when there is no image.
    return rows.map((row) => ({ item: row.item, image: row.image?.id ? row.image : null }));
  }

  async publishedTwins(groupIds: string[]) {
    const twins: Pick<ItemRow, "translationGroupId" | "type" | "locale" | "slug">[] = [];
    for (let start = 0; start < groupIds.length; start += CHUNK) {
      twins.push(
        ...(await this.db
          .select({
            translationGroupId: contentItems.translationGroupId,
            type: contentItems.type,
            locale: contentItems.locale,
            slug: contentItems.slug,
          })
          .from(contentItems)
          .where(
            and(
              inArray(contentItems.translationGroupId, groupIds.slice(start, start + CHUNK)),
              isLive,
            ),
          )),
      );
    }
    return twins;
  }
}

export type { RevisionRow };
