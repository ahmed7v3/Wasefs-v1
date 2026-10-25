import { Inject, Injectable } from "@nestjs/common";
import {
  contentCategories,
  contentItems,
  contentItemTags,
  contentPeople,
  contentTags,
  type ContentCategory,
  type ContentTag,
} from "@wasfa/db";
import { asc, count, eq, inArray, isNull, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import { enqueueContentChanged } from "./content-events.js";
import { applyAutoRedirectsTx } from "./redirects.repo.js";
import {
  planTagMerge,
  tagMergePathMoves,
  tagPaths,
  tagRenamePathMoves,
  type PlannedPathMove,
} from "./taxonomy-rules.js";

import type { CategoryInput, TagInput } from "@wasfa/shared/schemas/content";

export type CategoryRow = ContentCategory & { itemCount: number };
export type TagRow = ContentTag & { itemCount: number };

// Inside a raw subquery drizzle renders the outer table's column unqualified ("id"), which would bind to the
// inner table; the outer reference is spelled out.
const categoryItemCount = sql<number>`(select count(*)::int from ${contentItems} where ${contentItems.categoryId} = "content_categories"."id")`;
const tagItemCount = sql<number>`(select count(*)::int from ${contentItemTags} where ${contentItemTags.tagId} = "content_tags"."id")`;

/** Categories and tags. Platform data (no owner); only admin routes reach it. */
@Injectable()
export class TaxonomyRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  // ---- categories ----------------------------------------------------------------------------

  async listCategories(): Promise<CategoryRow[]> {
    const rows = await this.handle.db
      .select({ category: contentCategories, itemCount: categoryItemCount })
      .from(contentCategories)
      .orderBy(asc(contentCategories.sort), asc(contentCategories.nameAr));
    return rows.map((row) => ({ ...row.category, itemCount: row.itemCount }));
  }

  async findCategory(id: string): Promise<CategoryRow | undefined> {
    const [row] = await this.handle.db
      .select({ category: contentCategories, itemCount: categoryItemCount })
      .from(contentCategories)
      .where(eq(contentCategories.id, id));
    return row === undefined ? undefined : { ...row.category, itemCount: row.itemCount };
  }

  async childCount(id: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: count() })
      .from(contentCategories)
      .where(eq(contentCategories.parentId, id));
    return row?.total ?? 0;
  }

  async siblingIds(parentId: string | null): Promise<string[]> {
    const rows = await this.handle.db
      .select({ id: contentCategories.id })
      .from(contentCategories)
      .where(
        parentId === null
          ? isNull(contentCategories.parentId)
          : eq(contentCategories.parentId, parentId),
      );
    return rows.map((row) => row.id);
  }

  async personExists(id: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: contentPeople.id })
      .from(contentPeople)
      .where(eq(contentPeople.id, id));
    return row !== undefined;
  }

  /** Throws a unique violation for a taken slug; the service maps it. */
  async insertCategory(input: CategoryInput): Promise<{ row: ContentCategory; eventKey: string }> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx.insert(contentCategories).values(input).returning();
      if (row === undefined) throw new Error("insert returned no row");
      return { row, eventKey: await enqueueContentChanged(tx, "taxonomy", `category:${row.id}`) };
    });
  }

  async updateCategory(
    id: string,
    input: CategoryInput,
  ): Promise<{ row: ContentCategory; eventKey: string } | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(contentCategories)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(contentCategories.id, id))
        .returning();
      if (row === undefined) return undefined;
      return { row, eventKey: await enqueueContentChanged(tx, "taxonomy", `category:${id}`) };
    });
  }

  async deleteCategory(id: string): Promise<string | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const rows = await tx
        .delete(contentCategories)
        .where(eq(contentCategories.id, id))
        .returning();
      return rows.length === 0
        ? undefined
        : enqueueContentChanged(tx, "taxonomy", `category:${id}`);
    });
  }

  /** Writes `sort = position` for the listed siblings in one transaction. */
  async reorderCategories(ids: readonly string[]): Promise<string> {
    return this.handle.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await tx
          .update(contentCategories)
          .set({ sort: position, updatedAt: new Date() })
          .where(eq(contentCategories.id, id));
      }
      return enqueueContentChanged(tx, "taxonomy", "category:order");
    });
  }

  // ---- tags ----------------------------------------------------------------------------------

  async listTags(): Promise<TagRow[]> {
    const rows = await this.handle.db
      .select({ tag: contentTags, itemCount: tagItemCount })
      .from(contentTags)
      .orderBy(asc(contentTags.nameAr));
    return rows.map((row) => ({ ...row.tag, itemCount: row.itemCount }));
  }

  async findTag(id: string): Promise<TagRow | undefined> {
    const [row] = await this.handle.db
      .select({ tag: contentTags, itemCount: tagItemCount })
      .from(contentTags)
      .where(eq(contentTags.id, id));
    return row === undefined ? undefined : { ...row.tag, itemCount: row.itemCount };
  }

  async insertTag(input: TagInput): Promise<{ row: ContentTag; eventKey: string }> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx.insert(contentTags).values(input).returning();
      if (row === undefined) throw new Error("insert returned no row");
      return {
        row,
        eventKey: await enqueueContentChanged(tx, "taxonomy", `tag:${row.id}`, {
          paths: tagPaths(row),
        }),
      };
    });
  }

  /** Updates a tag; slug changes write their `slug_changed` redirects in the same transaction. */
  async updateTag(
    id: string,
    input: TagInput,
    before: Pick<ContentTag, "slugAr" | "slugEn">,
    actorId: string,
  ): Promise<{ row: ContentTag; eventKey: string; moves: PlannedPathMove[] } | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .update(contentTags)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(contentTags.id, id))
        .returning();
      if (row === undefined) return undefined;
      const moves = tagRenamePathMoves(before, row);
      await applyAutoRedirectsTx(tx, moves, "slug_changed", actorId);
      const eventKey = await enqueueContentChanged(tx, "taxonomy", `tag:${id}`, {
        paths: tagPaths(row),
        oldPaths: moves.map((move) => move.fromPath),
      });
      return { row, eventKey, moves };
    });
  }

  async deleteTag(id: string): Promise<string | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx.delete(contentTags).where(eq(contentTags.id, id)).returning();
      return row === undefined
        ? undefined
        : enqueueContentChanged(tx, "taxonomy", `tag:${id}`, { oldPaths: tagPaths(row) });
    });
  }

  /** Repoints `from`'s items to `into`, redirects its pages and deletes it: one transaction. */
  async mergeTags(
    from: ContentTag,
    into: ContentTag,
    actorId: string,
  ): Promise<{ repointed: number; dropped: number; eventKey: string; moves: PlannedPathMove[] }> {
    return this.handle.db.transaction(async (tx) => {
      const fromRows = await tx
        .select({ itemId: contentItemTags.itemId })
        .from(contentItemTags)
        .where(eq(contentItemTags.tagId, from.id));
      const intoRows = await tx
        .select({ itemId: contentItemTags.itemId })
        .from(contentItemTags)
        .where(eq(contentItemTags.tagId, into.id));
      const plan = planTagMerge({
        fromItemIds: fromRows.map((row) => row.itemId),
        intoItemIds: intoRows.map((row) => row.itemId),
      });
      if (plan.repoint.length > 0) {
        await tx
          .insert(contentItemTags)
          .values(plan.repoint.map((itemId) => ({ itemId, tagId: into.id })))
          .onConflictDoNothing();
      }
      // The cascade removes the merged tag's own rows.
      await tx.delete(contentTags).where(eq(contentTags.id, from.id));
      const moves = tagMergePathMoves(from, into);
      await applyAutoRedirectsTx(tx, moves, "merged", actorId);
      const eventKey = await enqueueContentChanged(tx, "taxonomy", `tag-merge:${from.id}`, {
        paths: tagPaths(into),
        oldPaths: moves.map((move) => move.fromPath),
      });
      return { repointed: plan.repoint.length, dropped: plan.drop.length, eventKey, moves };
    });
  }

  async tagsExist(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const [row] = await this.handle.db
      .select({ total: count() })
      .from(contentTags)
      .where(inArray(contentTags.id, [...ids]));
    return row?.total ?? 0;
  }
}
