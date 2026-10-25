import { contentPath } from "@wasfa/shared/content/paths";
import { and, asc, count, eq, gte, lte } from "drizzle-orm";

import { enqueueOutbox } from "./outbox.js";
import { contentItems, contentPublishLog, contentRevisions } from "./schema/index.js";

import type { Transaction } from "./credits-ledger.js";
import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

/*
 * Transactional publish / unpublish of a content item (CONTENT-PLATFORM §4, §11.2), shared by the API
 * (manual publish) and the worker (scheduled publish). Plain functions over a caller-provided
 * transaction, like withdrawals.ts: the item row is locked FOR UPDATE, the pointer move, the audit
 * row and the `content.changed` outbox event commit together or not at all. Permission and quality
 * gate checks belong to the callers; these helpers only move state.
 */

export interface ContentActor {
  type: "user" | "api_key" | "system";
  id: string | null;
  name: string;
}

export interface PublishItemInput {
  itemId: string;
  /** Defaults to the item's current revision. */
  revisionId?: string;
  actor: ContentActor;
  now: Date;
  reason?: string;
}

export interface PublishItemResult {
  publishedRevisionId: string;
  firstPublish: boolean;
  slug: string;
  type: ContentType;
  locale: ContentLocale;
}

export interface UnpublishItemInput {
  itemId: string;
  actor: ContentActor;
  now: Date;
  reason?: string;
}

export class ContentPublishError extends Error {
  constructor(readonly reason: "not_found" | "no_revision") {
    super(`Content publish refused: ${reason}`);
    this.name = "ContentPublishError";
  }
}

async function lockItem(tx: Transaction, itemId: string) {
  // Same lock the other workflow writes take, so publish serialises with edits and unpublish.
  const [row] = await tx
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, itemId))
    .limit(1)
    .for("update");
  if (!row) throw new ContentPublishError("not_found");
  return row;
}

export async function publishItemTx(
  tx: Transaction,
  input: PublishItemInput,
): Promise<PublishItemResult> {
  const item = await lockItem(tx, input.itemId);
  const revisionId = input.revisionId ?? item.currentRevisionId;
  if (!revisionId) throw new ContentPublishError("no_revision");

  const [next] = await tx
    .select({
      id: contentRevisions.id,
      title: contentRevisions.title,
      excerpt: contentRevisions.excerpt,
      definition: contentRevisions.definition,
      bodyMd: contentRevisions.bodyMd,
    })
    .from(contentRevisions)
    .where(and(eq(contentRevisions.id, revisionId), eq(contentRevisions.itemId, item.id)))
    .limit(1);
  if (!next) throw new ContentPublishError("no_revision");

  const firstPublish = item.firstPublishedAt === null;
  let substantive = firstPublish;
  if (!substantive && item.publishedRevisionId) {
    const [previous] = await tx
      .select({
        title: contentRevisions.title,
        excerpt: contentRevisions.excerpt,
        definition: contentRevisions.definition,
        bodyMd: contentRevisions.bodyMd,
      })
      .from(contentRevisions)
      .where(eq(contentRevisions.id, item.publishedRevisionId))
      .limit(1);
    substantive =
      !previous ||
      previous.title !== next.title ||
      previous.excerpt !== next.excerpt ||
      previous.definition !== next.definition ||
      previous.bodyMd !== next.bodyMd;
  }

  await tx
    .update(contentItems)
    .set({
      status: "published",
      publishedRevisionId: next.id,
      publishedAt: input.now,
      firstPublishedAt: item.firstPublishedAt ?? input.now,
      scheduledAt: null,
      ...(substantive ? { contentUpdatedAt: input.now } : {}),
      updatedAt: input.now,
    })
    .where(eq(contentItems.id, item.id));

  await tx.insert(contentPublishLog).values({
    itemId: item.id,
    revisionId: next.id,
    fromStatus: item.status,
    toStatus: "published",
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    reason: input.reason ?? null,
    at: input.now,
  });

  await enqueueOutbox(
    tx,
    "content.changed",
    {
      itemId: item.id,
      kind: "published",
      paths: [contentPath(item.type, item.locale, item.slug)],
      oldPaths: [] as string[],
    },
    `content.changed:${item.id}:${next.id}:published`,
  );

  return {
    publishedRevisionId: next.id,
    firstPublish,
    slug: item.slug,
    type: item.type,
    locale: item.locale,
  };
}

export async function unpublishItemTx(tx: Transaction, input: UnpublishItemInput): Promise<void> {
  const item = await lockItem(tx, input.itemId);
  const oldRevisionId = item.publishedRevisionId;

  await tx
    .update(contentItems)
    .set({
      status: "draft",
      publishedRevisionId: null,
      scheduledAt: null,
      updatedAt: input.now,
    })
    .where(eq(contentItems.id, item.id));

  await tx.insert(contentPublishLog).values({
    itemId: item.id,
    revisionId: oldRevisionId,
    fromStatus: item.status,
    toStatus: "draft",
    actorType: input.actor.type,
    actorId: input.actor.id,
    actorName: input.actor.name,
    reason: input.reason ?? null,
    at: input.now,
  });

  const oldPath = contentPath(item.type, item.locale, item.slug);
  await enqueueOutbox(
    tx,
    "content.changed",
    { itemId: item.id, kind: "unpublished", paths: [] as string[], oldPaths: [oldPath] },
    // The time makes a publish -> unpublish -> publish -> unpublish cycle distinct per unpublish.
    `content.changed:${item.id}:${oldRevisionId ?? "none"}:unpublished:${String(input.now.getTime())}`,
  );
}

/** Publishes since `since`, for the daily publish cap. */
export async function countPublishedSince(tx: Transaction, since: Date): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(contentPublishLog)
    .where(and(eq(contentPublishLog.toStatus, "published"), gte(contentPublishLog.at, since)));
  return row?.total ?? 0;
}

export interface DueScheduledItem {
  id: string;
  scheduledAt: Date;
}

/** Scheduled items whose time has come, locked with SKIP LOCKED so concurrent workers split them. */
export async function dueScheduledItems(
  tx: Transaction,
  now: Date,
  limit: number,
): Promise<DueScheduledItem[]> {
  const rows = await tx
    .select({ id: contentItems.id, scheduledAt: contentItems.scheduledAt })
    .from(contentItems)
    .where(and(eq(contentItems.status, "scheduled"), lte(contentItems.scheduledAt, now)))
    .orderBy(asc(contentItems.scheduledAt), asc(contentItems.id))
    .limit(limit)
    .for("update", { skipLocked: true });
  return rows.flatMap((row) => (row.scheduledAt ? [{ id: row.id, scheduledAt: row.scheduledAt }] : []));
}

