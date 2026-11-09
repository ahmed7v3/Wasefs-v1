import { Inject, Injectable } from "@nestjs/common";
import {
  contentItems,
  contentRevisions,
  publishingIdempotency,
  purgeExpiredPublishingIdempotency,
  type ContentItem,
} from "@wasfa/db";
import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";

import { afterCursor, stamp, toPage, type Cursor, type Page } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";

import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";
import type { PublishingListQuery } from "@wasfa/shared/schemas/publishing";

/*
 * The Publishing API's own queries: items by (key, external id) and by public slug, the key-scoped
 * list, and the idempotency table. Everything else (items, revisions, workflow, taxonomy) goes through
 * the content stack's own repositories and services.
 */

export interface ApiListRow {
  item: ContentItem;
  revisionNumber: number;
  quality: unknown;
  cursorAt: string;
}

export interface IdempotencyRecord {
  requestHash: string;
  status: number | null;
  response: unknown;
}

@Injectable()
export class PublishingApiRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findByExternalId(keyId: string, externalId: string): Promise<ContentItem | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.apiKeyId, keyId), eq(contentItems.externalId, externalId)));
    return row;
  }

  async findBySlug(
    type: ContentType,
    locale: ContentLocale,
    slug: string,
  ): Promise<ContentItem | undefined> {
    const [row] = await this.handle.db
      .select()
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

  /**
   * Items this key wrote, plus anything publicly live (a key may read what the public can read). Newest
   * update first; `limit + 1` rows, the extra one says another page exists.
   */
  async list(
    keyId: string,
    query: PublishingListQuery,
    categoryId: string | undefined,
    cursor: Cursor | undefined,
  ): Promise<ApiListRow[]> {
    const conditions: (SQL | undefined)[] = [
      or(eq(contentItems.apiKeyId, keyId), sql`${contentItems.publishedRevisionId} is not null`),
      query.status ? eq(contentItems.status, query.status) : undefined,
      query.type ? eq(contentItems.type, query.type) : undefined,
      query.locale ? eq(contentItems.locale, query.locale) : undefined,
      categoryId ? eq(contentItems.categoryId, categoryId) : undefined,
      query.updated_since ? gte(contentItems.updatedAt, new Date(query.updated_since)) : undefined,
      // An external id belongs to one key: only this key's own items can match it.
      query.external_id
        ? and(eq(contentItems.apiKeyId, keyId), eq(contentItems.externalId, query.external_id))
        : undefined,
      cursor ? afterCursor(contentItems.updatedAt, contentItems.id, cursor, "uuid") : undefined,
    ];
    const rows = await this.handle.db
      .select({
        item: contentItems,
        revisionNumber: contentRevisions.number,
        quality: contentRevisions.quality,
        cursorAt: stamp(contentItems.updatedAt),
      })
      .from(contentItems)
      .innerJoin(contentRevisions, eq(contentRevisions.id, contentItems.currentRevisionId))
      .where(and(...conditions))
      .orderBy(desc(contentItems.updatedAt), desc(contentItems.id))
      .limit(query.limit + 1);
    return rows;
  }

  static page(rows: readonly ApiListRow[], limit: number): Page<ApiListRow> {
    return toPage(rows, limit, (row) => ({ at: row.cursorAt, key: row.item.id }));
  }

  // ---- idempotency -------------------------------------------------------------------------

  /** Claims `(key, idemKey)`: true when this request is the first; false when a row already exists. */
  async claimIdempotency(
    keyId: string,
    idemKey: string,
    requestHash: string,
    now: Date,
    ttlCutoff: Date,
  ): Promise<boolean> {
    // An expired row is as good as absent: remove it so the key can be reused after 24 h.
    await this.handle.db
      .delete(publishingIdempotency)
      .where(
        and(
          eq(publishingIdempotency.keyId, keyId),
          eq(publishingIdempotency.idemKey, idemKey),
          lt(publishingIdempotency.createdAt, ttlCutoff),
        ),
      );
    const rows = await this.handle.db
      .insert(publishingIdempotency)
      .values({ keyId, idemKey, requestHash, createdAt: now })
      .onConflictDoNothing()
      .returning({ keyId: publishingIdempotency.keyId });
    return rows.length > 0;
  }

  async findIdempotency(keyId: string, idemKey: string): Promise<IdempotencyRecord | undefined> {
    const [row] = await this.handle.db
      .select({
        requestHash: publishingIdempotency.requestHash,
        status: publishingIdempotency.status,
        response: publishingIdempotency.response,
      })
      .from(publishingIdempotency)
      .where(
        and(eq(publishingIdempotency.keyId, keyId), eq(publishingIdempotency.idemKey, idemKey)),
      );
    return row;
  }

  async completeIdempotency(
    keyId: string,
    idemKey: string,
    status: number,
    response: unknown,
  ): Promise<void> {
    await this.handle.db
      .update(publishingIdempotency)
      .set({ status, response })
      .where(
        and(eq(publishingIdempotency.keyId, keyId), eq(publishingIdempotency.idemKey, idemKey)),
      );
  }

  async releaseIdempotency(keyId: string, idemKey: string): Promise<void> {
    await this.handle.db
      .delete(publishingIdempotency)
      .where(
        and(eq(publishingIdempotency.keyId, keyId), eq(publishingIdempotency.idemKey, idemKey)),
      );
  }

  purgeExpiredIdempotency(now: Date): Promise<number> {
    return purgeExpiredPublishingIdempotency(this.handle.db, now);
  }
}
