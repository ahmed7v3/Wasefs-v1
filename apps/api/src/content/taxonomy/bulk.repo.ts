import { Inject, Injectable } from "@nestjs/common";
import {
  contentCategories,
  contentItems,
  contentItemTags,
  contentPeople,
  contentTags,
  enqueueOutbox,
} from "@wasfa/db";
import { contentPath } from "@wasfa/shared/content";
import { CONTENT_CHANGED_TOPIC, contentChangedPayloadSchema } from "@wasfa/shared/schemas/content";
import { and, eq, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { Transaction } from "@wasfa/db";
import type { ContentStatus, ContentType } from "@wasfa/shared/content/constants";

export interface BulkItemRow {
  id: string;
  type: ContentType;
  status: ContentStatus;
  categoryRequiresReview: boolean | null;
}

@Injectable()
export class BulkRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async items(ids: readonly string[]): Promise<BulkItemRow[]> {
    return this.handle.db
      .select({
        id: contentItems.id,
        type: contentItems.type,
        status: contentItems.status,
        categoryRequiresReview: contentCategories.requiresMedicalReview,
      })
      .from(contentItems)
      .leftJoin(contentCategories, eq(contentCategories.id, contentItems.categoryId))
      .where(inArray(contentItems.id, [...ids]));
  }

  async categoryExists(id: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: contentCategories.id })
      .from(contentCategories)
      .where(eq(contentCategories.id, id));
    return row !== undefined;
  }

  /** A reviewer must be an active person whose role includes reviewing. */
  async reviewerEligible(id: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: contentPeople.id })
      .from(contentPeople)
      .where(
        and(
          eq(contentPeople.id, id),
          eq(contentPeople.active, true),
          inArray(contentPeople.role, ["reviewer", "both"]),
        ),
      );
    return row !== undefined;
  }

  async existingTagIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.handle.db
      .select({ id: contentTags.id })
      .from(contentTags)
      .where(inArray(contentTags.id, [...ids]));
    return new Set(rows.map((row) => row.id));
  }

  async tagIdsOf(itemIds: readonly string[]): Promise<Map<string, string[]>> {
    const rows = await this.handle.db
      .select({ itemId: contentItemTags.itemId, tagId: contentItemTags.tagId })
      .from(contentItemTags)
      .where(inArray(contentItemTags.itemId, [...itemIds]));
    const byItem = new Map<string, string[]>();
    for (const row of rows) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row.tagId]);
    return byItem;
  }

  /**
   * Item-level metadata applies live without re-review, so a live item's page is announced as
   * updated. `lock_version` moves so an editor that loaded the old metadata gets a conflict, not a
   * silent overwrite.
   */
  private async touch(
    tx: Transaction,
    ids: readonly string[],
    set: Partial<{ categoryId: string | null; reviewerId: string | null }>,
  ) {
    const rows = await tx
      .update(contentItems)
      .set({ ...set, updatedAt: new Date(), lockVersion: sql`${contentItems.lockVersion} + 1` })
      .where(inArray(contentItems.id, [...ids]))
      .returning({
        id: contentItems.id,
        type: contentItems.type,
        locale: contentItems.locale,
        slug: contentItems.slug,
        live: contentItems.publishedRevisionId,
      });
    await this.announce(tx, rows);
    return rows.map((row) => row.id);
  }

  private async announce(
    tx: Transaction,
    rows: readonly {
      id: string;
      type: ContentType;
      locale: "ar" | "en";
      slug: string;
      live: string | null;
    }[],
  ): Promise<void> {
    const stamp = String(Date.now());
    for (const row of rows) {
      if (row.live === null) continue;
      await enqueueOutbox(
        tx,
        CONTENT_CHANGED_TOPIC,
        contentChangedPayloadSchema.parse({
          itemId: row.id,
          kind: "updated",
          paths: [contentPath(row.type, row.locale, row.slug)],
        }),
        `${CONTENT_CHANGED_TOPIC}:${row.id}:bulk:${stamp}`,
      );
    }
  }

  async setCategory(ids: readonly string[], categoryId: string | null): Promise<string[]> {
    return this.handle.db.transaction((tx) => this.touch(tx, ids, { categoryId }));
  }

  async setReviewer(ids: readonly string[], reviewerId: string | null): Promise<string[]> {
    return this.handle.db.transaction((tx) => this.touch(tx, ids, { reviewerId }));
  }

  /** Replaces each item's tag set with the planned one. */
  async replaceTags(plans: ReadonlyMap<string, readonly string[]>): Promise<string[]> {
    if (plans.size === 0) return [];
    return this.handle.db.transaction(async (tx) => {
      const ids = [...plans.keys()];
      await tx.delete(contentItemTags).where(inArray(contentItemTags.itemId, ids));
      const values = [...plans].flatMap(([itemId, tagIds]) =>
        tagIds.map((tagId) => ({ itemId, tagId })),
      );
      if (values.length > 0) await tx.insert(contentItemTags).values(values);
      return this.touch(tx, ids, {});
    });
  }
}
