import { Inject, Injectable } from "@nestjs/common";
import {
  contentItems,
  contentPeople,
  contentPublishLog,
  mediaAssets,
  publishingApiKeys,
  publishingApiRequests,
  publishingWebhookDeliveries,
  users,
  type NewPublishingApiKeyRow,
  type PublishingApiKeyRow,
  type PublishingApiRequestRow,
} from "@wasfa/db";
import { and, count, desc, eq, gte, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import { PUBLISHING_CREATE_ROUTES, PUBLISHING_PUBLISH_ROUTES } from "./publishing-routes.js";

export interface KeyUsage {
  requestsToday: number;
  errorsToday: number;
  itemsCreatedToday: number;
  publishedToday: number;
}

export interface KeyWithOwner {
  row: PublishingApiKeyRow;
  ownerName: string | null;
}

export type KeyPatch = Partial<
  Pick<
    PublishingApiKeyRow,
    | "name"
    | "scopes"
    | "canPublish"
    | "requireSignature"
     | "webhookUrlEnc"
     | "webhookSecretEnc"
    | "allowedTypes"
    | "allowedCategorySlugs"
    | "defaultAuthorId"
    | "defaultFeaturedMediaId"
    | "dailyPublishCap"
    | "requestsPerMinute"
    | "ipAllowList"
  >
>;

export interface RequestLogEntry {
  keyId: string | null;
  method: string;
  route: string;
  status: number;
  latencyMs: number;
  errorCode: string | null;
  itemId: string | null;
  idempotencyKey: string | null;
}

/** `(method, route)` pairs of the route constants as one OR condition on the request log. */
function routePairs(pairs: readonly { method: string; route: string }[]): SQL {
  return sql.join(
    pairs.map(
      (pair) =>
        sql`(${publishingApiRequests.method} = ${pair.method} and ${publishingApiRequests.route} = ${pair.route})`,
    ),
    sql` or `,
  );
}

/** API keys of the Publishing API and their request log. Platform data (admin and key-auth routes only). */
@Injectable()
export class PublishingKeysRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findByKeyId(keyId: string): Promise<PublishingApiKeyRow | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(publishingApiKeys)
      .where(eq(publishingApiKeys.keyId, keyId))
      .limit(1);
    return row;
  }

  async findById(id: string): Promise<KeyWithOwner | undefined> {
    const [row] = await this.handle.db
      .select({ row: publishingApiKeys, ownerName: users.name })
      .from(publishingApiKeys)
      .leftJoin(users, eq(users.id, publishingApiKeys.ownerUserId))
      .where(eq(publishingApiKeys.id, id))
      .limit(1);
    return row;
  }

  list(): Promise<KeyWithOwner[]> {
    return this.handle.db
      .select({ row: publishingApiKeys, ownerName: users.name })
      .from(publishingApiKeys)
      .leftJoin(users, eq(users.id, publishingApiKeys.ownerUserId))
      .orderBy(desc(publishingApiKeys.createdAt));
  }

  async insert(values: NewPublishingApiKeyRow): Promise<PublishingApiKeyRow> {
    const [row] = await this.handle.db.insert(publishingApiKeys).values(values).returning();
    if (!row) throw new Error("publishing key insert returned no row");
    return row;
  }

  async update(id: string, patch: KeyPatch): Promise<PublishingApiKeyRow | undefined> {
    if (Object.keys(patch).length === 0) return (await this.findById(id))?.row;
    const [row] = await this.handle.db
      .update(publishingApiKeys)
      .set(patch)
      .where(eq(publishingApiKeys.id, id))
      .returning();
    return row;
  }

  async revoke(id: string, now: Date): Promise<PublishingApiKeyRow | undefined> {
    const [row] = await this.handle.db
      .update(publishingApiKeys)
      .set({ revokedAt: now, prevSecretHash: null, prevValidUntil: null })
      .where(eq(publishingApiKeys.id, id))
      .returning();
    return row;
  }

  async rotate(
    id: string,
    next: { secretHash: string; last4: string; graceUntil: Date | null },
  ): Promise<PublishingApiKeyRow | undefined> {
    // The current hash becomes the previous one in the same statement, so there is no window with neither.
    const [row] = await this.handle.db
      .update(publishingApiKeys)
      .set({
        prevSecretHash: next.graceUntil === null ? null : publishingApiKeys.secretHash,
        prevValidUntil: next.graceUntil,
        secretHash: next.secretHash,
        last4: next.last4,
      })
      .where(eq(publishingApiKeys.id, id))
      .returning();
    return row;
  }

  async touchLastUsed(id: string, now: Date): Promise<void> {
    await this.handle.db
      .update(publishingApiKeys)
      .set({ lastUsedAt: now })
      .where(eq(publishingApiKeys.id, id));
  }

  async personExists(id: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: contentPeople.id })
      .from(contentPeople)
      .where(eq(contentPeople.id, id))
      .limit(1);
    return row !== undefined;
  }

  /** The default featured image must be a finished raster image, not a pending or rejected upload. */
  async mediaIsReady(id: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ status: mediaAssets.status, mime: mediaAssets.mime })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .limit(1);
    return row !== undefined && row.status === "ready" && (row.mime ?? "").startsWith("image/");
  }

  async insertRequest(entry: RequestLogEntry): Promise<void> {
    await this.handle.db.insert(publishingApiRequests).values(entry);
  }

  recentWebhookDeliveries(id: string, limit: number) {
    return this.handle.db
      .select()
      .from(publishingWebhookDeliveries)
      .where(eq(publishingWebhookDeliveries.keyId, id))
      .orderBy(desc(publishingWebhookDeliveries.createdAt))
      .limit(limit);
  }

  recentRequests(id: string, limit: number): Promise<PublishingApiRequestRow[]> {
    return this.handle.db
      .select()
      .from(publishingApiRequests)
      .where(eq(publishingApiRequests.keyId, id))
      .orderBy(desc(publishingApiRequests.at), desc(publishingApiRequests.id))
      .limit(limit);
  }

  /** Usage since `since` (start of the Cairo day) per key id; keys without requests are absent. */
  async usageSince(ids: readonly string[], since: Date): Promise<Map<string, KeyUsage>> {
    const usage = new Map<string, KeyUsage>();
    if (ids.length === 0) return usage;
    const ok = sql`${publishingApiRequests.status} between 200 and 299`;
    const rows = await this.handle.db
      .select({
        keyId: publishingApiRequests.keyId,
        requests: count(),
        errors: sql<number>`count(*) filter (where ${publishingApiRequests.status} >= 400)::int`,
        created: sql<number>`count(*) filter (where ${ok} and (${routePairs(PUBLISHING_CREATE_ROUTES)}))::int`,
        published: sql<number>`count(*) filter (where ${ok} and (${routePairs(PUBLISHING_PUBLISH_ROUTES)}))::int`,
      })
      .from(publishingApiRequests)
      .where(
        and(isNotNull(publishingApiRequests.keyId), inArray(publishingApiRequests.keyId, [...ids]), gte(publishingApiRequests.at, since)),
      )
      .groupBy(publishingApiRequests.keyId);
    for (const row of rows) {
      if (row.keyId === null) continue;
      usage.set(row.keyId, {
        requestsToday: row.requests,
        errorsToday: row.errors,
        // The request log is one row per HTTP call, so it cannot represent all successful
        // creations in a batch. This value is replaced below with the authoritative item count.
        itemsCreatedToday: row.created,
        publishedToday: row.published,
      });
    }
    const createdRows = await this.handle.db
      .select({ keyId: contentItems.apiKeyId, created: sql<number>`count(*)::int` })
      .from(contentItems)
      .where(
        and(
          isNotNull(contentItems.apiKeyId),
          inArray(contentItems.apiKeyId, [...ids]),
          gte(contentItems.createdAt, since),
        ),
      )
      .groupBy(contentItems.apiKeyId);
    for (const row of createdRows) {
      if (row.keyId === null) continue;
      const existing = usage.get(row.keyId) ?? {
        requestsToday: 0,
        errorsToday: 0,
        itemsCreatedToday: 0,
        publishedToday: 0,
      };
      usage.set(row.keyId, { ...existing, itemsCreatedToday: row.created });
    }
    return usage;
  }

  /** Read-only: publishes site-wide since `since` (what the global daily cap counts). */
  async globalPublishedSince(since: Date): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: count() })
      .from(contentPublishLog)
      .where(and(eq(contentPublishLog.toStatus, "published"), gte(contentPublishLog.at, since)));
    return row?.total ?? 0;
  }
}
