import { Inject, Injectable } from "@nestjs/common";
import {
  contentCategories,
  contentEntities,
  contentItems,
  contentPeople,
  contentRevisions,
  contentTags,
} from "@wasfa/db";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { stamp, type Cursor } from "../../admin/common/keyset.js";
import { DB, type DbHandle } from "../../common/database.js";

import type { MineFilter } from "./inbox-rules.js";
import type { ContentType } from "@wasfa/shared/content/constants";

export interface InboxRow {
  id: string;
  type: ContentType;
  locale: "ar" | "en";
  slug: string;
  title: string;
  categoryId: string | null;
  categoryName: string | null;
  authorId: string | null;
  authorName: string | null;
  authorSlug: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewerSlug: string | null;
  submittedAt: Date;
  cursorAt: string;
  submitted: { title: string; bodyMd: string } | null;
  approved: { title: string; bodyMd: string } | null;
}

export interface LinkCandidate {
  id: string;
  type: ContentType;
  slug: string;
  title: string;
  categoryId: string | null;
  similarity: number;
}

/** Reads for the reviewer inbox and the editor's link picker. */
@Injectable()
export class InboxRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Items waiting for review, oldest submission first (keyset on submission time, then id). */
  async inReview(input: {
    categoryId?: string | undefined;
    mine: MineFilter;
    cursor?: Cursor | undefined;
    limit: number;
  }): Promise<InboxRow[]> {
    const author = alias(contentPeople, "author");
    const reviewer = alias(contentPeople, "reviewer");
    const submitted = alias(contentRevisions, "submitted");
    const approved = alias(contentRevisions, "approved");
    const submittedAt = sql<Date>`coalesce(${submitted.createdAt}, ${contentItems.updatedAt})`;

    const conditions: (SQL | undefined)[] = [
      eq(contentItems.status, "in_review"),
      input.categoryId === undefined ? undefined : eq(contentItems.categoryId, input.categoryId),
      input.mine.kind === "person"
        ? or(
            eq(contentItems.reviewerId, input.mine.personId),
            eq(contentCategories.defaultReviewerId, input.mine.personId),
          )
        : undefined,
      input.cursor === undefined
        ? undefined
        : sql`(${submittedAt}, ${contentItems.id}) > (${input.cursor.at}::timestamptz, ${input.cursor.key}::uuid)`,
    ];

    const rows = await this.handle.db
      .select({
        id: contentItems.id,
        type: contentItems.type,
        locale: contentItems.locale,
        slug: contentItems.slug,
        title: contentItems.title,
        categoryId: contentItems.categoryId,
        categoryName: contentCategories.nameAr,
        authorId: author.id,
        authorName: author.nameAr,
        authorSlug: author.slug,
        reviewerId: reviewer.id,
        reviewerName: reviewer.nameAr,
        reviewerSlug: reviewer.slug,
        submittedAt,
        cursorAt: stamp(submittedAt),
        submittedTitle: submitted.title,
        submittedBody: submitted.bodyMd,
        approvedTitle: approved.title,
        approvedBody: approved.bodyMd,
      })
      .from(contentItems)
      .leftJoin(contentCategories, eq(contentCategories.id, contentItems.categoryId))
      .leftJoin(author, eq(author.id, contentItems.primaryAuthorId))
      .leftJoin(reviewer, eq(reviewer.id, contentItems.reviewerId))
      .leftJoin(submitted, eq(submitted.id, contentItems.submittedRevisionId))
      .leftJoin(approved, eq(approved.id, contentItems.reviewedRevisionId))
      .where(and(...conditions))
      .orderBy(asc(submittedAt), asc(contentItems.id))
      .limit(input.limit + 1);

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      locale: row.locale,
      slug: row.slug,
      title: row.title,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      authorId: row.authorId,
      authorName: row.authorName,
      authorSlug: row.authorSlug,
      reviewerId: row.reviewerId,
      reviewerName: row.reviewerName,
      reviewerSlug: row.reviewerSlug,
      submittedAt: new Date(row.submittedAt),
      cursorAt: row.cursorAt,
      submitted:
        row.submittedTitle === null
          ? null
          : { title: row.submittedTitle, bodyMd: row.submittedBody ?? "" },
      approved:
        row.approvedTitle === null
          ? null
          : { title: row.approvedTitle, bodyMd: row.approvedBody ?? "" },
    }));
  }

  async itemForLinks(
    id: string,
  ): Promise<{ categoryId: string | null; entities: Set<string> } | undefined> {
    const [item] = await this.handle.db
      .select({ categoryId: contentItems.categoryId })
      .from(contentItems)
      .where(eq(contentItems.id, id));
    if (item === undefined) return undefined;
    const entities = await this.handle.db
      .select({ kind: contentEntities.kind, slug: contentEntities.slug })
      .from(contentEntities)
      .where(eq(contentEntities.itemId, id));
    return {
      categoryId: item.categoryId,
      entities: new Set(entities.map((entity) => `${entity.kind}:${entity.slug}`)),
    };
  }

  /** Live items of the locale whose title resembles the query (trigram or substring). */
  async linkCandidates(input: {
    itemId: string;
    q: string;
    locale: "ar" | "en";
    like: string;
  }): Promise<LinkCandidate[]> {
    const similarity = sql<number>`similarity(${contentItems.title}, ${input.q})::float8`;
    return this.handle.db
      .select({
        id: contentItems.id,
        type: contentItems.type,
        slug: contentItems.slug,
        title: contentItems.title,
        categoryId: contentItems.categoryId,
        similarity,
      })
      .from(contentItems)
      .where(
        and(
          sql`${contentItems.publishedRevisionId} is not null`,
          eq(contentItems.locale, input.locale),
          sql`${contentItems.id} <> ${input.itemId}`,
          sql`(${similarity} > 0.1 or ${contentItems.title} ilike ${input.like})`,
        ),
      )
      .orderBy(sql`${similarity} desc`)
      .limit(40);
  }

  async entitiesOf(itemIds: readonly string[]): Promise<Map<string, string[]>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.handle.db
      .select({
        itemId: contentEntities.itemId,
        kind: contentEntities.kind,
        slug: contentEntities.slug,
      })
      .from(contentEntities)
      .where(inArray(contentEntities.itemId, [...itemIds]));
    const byItem = new Map<string, string[]>();
    for (const row of rows) {
      byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), `${row.kind}:${row.slug}`]);
    }
    return byItem;
  }

  // ---- editor option lists -------------------------------------------------------------------

  async categoriesWithReviewer() {
    const reviewer = alias(contentPeople, "default_reviewer");
    return this.handle.db
      .select({
        id: contentCategories.id,
        parentId: contentCategories.parentId,
        nameAr: contentCategories.nameAr,
        nameEn: contentCategories.nameEn,
        slugAr: contentCategories.slugAr,
        slugEn: contentCategories.slugEn,
        requiresMedicalReview: contentCategories.requiresMedicalReview,
        reviewerId: reviewer.id,
        reviewerName: reviewer.nameAr,
        reviewerSlug: reviewer.slug,
        sort: contentCategories.sort,
      })
      .from(contentCategories)
      .leftJoin(reviewer, eq(reviewer.id, contentCategories.defaultReviewerId))
      .orderBy(asc(contentCategories.sort), asc(contentCategories.nameAr));
  }

  async tagOptions() {
    return this.handle.db
      .select({
        id: contentTags.id,
        nameAr: contentTags.nameAr,
        nameEn: contentTags.nameEn,
        slugAr: contentTags.slugAr,
        slugEn: contentTags.slugEn,
      })
      .from(contentTags)
      .orderBy(asc(contentTags.nameAr));
  }

  async activePeople() {
    return this.handle.db
      .select({
        id: contentPeople.id,
        slug: contentPeople.slug,
        nameAr: contentPeople.nameAr,
        nameEn: contentPeople.nameEn,
        role: contentPeople.role,
      })
      .from(contentPeople)
      .where(eq(contentPeople.active, true))
      .orderBy(asc(contentPeople.nameAr));
  }
}
