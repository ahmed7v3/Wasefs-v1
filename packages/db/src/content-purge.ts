import { contentPath } from "@wasfa/shared/content/paths";
import { eq, or, sql } from "drizzle-orm";

import { enqueueOutbox } from "./outbox.js";
import { contentItems, contentRevisions, slugRedirects } from "./schema/index.js";

import type { Transaction } from "./credits-ledger.js";
import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

/*
 * Permanent delete of one content item (owner-only, CONTENT-PLATFORM §11.1). Revisions are
 * immutable, so the guard trigger (migration 0024) allows DELETE only while the transaction-local
 * flag `wasfa.content_purge` is 'on'; this is the only code that sets it. Every other table that
 * references the item (autosaves, tags, links, entities, media refs, corrections, publish log,
 * review comments) is ON DELETE CASCADE, and `content_links.target_item_id` of OTHER items is
 * SET NULL, so deleting the item row is enough for them. media_assets rows and files are never
 * touched: only the item's links to them (content_media_refs, featured_media_id) go.
 */

export class ContentPurgeError extends Error {
  constructor(readonly reason: "not_found") {
    super(`Content purge refused: ${reason}`);
    this.name = "ContentPurgeError";
  }
}

export interface PurgeItemInput {
  itemId: string;
  now: Date;
}

export interface PurgeItemResult {
  type: ContentType;
  locale: ContentLocale;
  slug: string;
  path: string;
  wasLive: boolean;
}

export async function purgeItemTx(
  tx: Transaction,
  input: PurgeItemInput,
): Promise<PurgeItemResult> {
  await tx.execute(sql`SET LOCAL wasfa.content_purge = 'on'`);

  const [item] = await tx
    .select()
    .from(contentItems)
    .where(eq(contentItems.id, input.itemId))
    .limit(1)
    .for("update");
  if (!item) throw new ContentPurgeError("not_found");

  const path = contentPath(item.type, item.locale, item.slug);
  const wasLive = item.firstPublishedAt !== null || item.publishedRevisionId !== null;

  // The pointers use RESTRICT (checked immediately even though DEFERRABLE), so release them first.
  await tx
    .update(contentItems)
    .set({
      currentRevisionId: null,
      reviewedRevisionId: null,
      publishedRevisionId: null,
      submittedRevisionId: null,
    })
    .where(eq(contentItems.id, item.id));
  // content_revisions.item_id is RESTRICT: the revisions go before the item.
  await tx.delete(contentRevisions).where(eq(contentRevisions.itemId, item.id));
  // Cascades the item's autosaves, tags, links, entities, media refs, corrections, publish log and comments.
  await tx.delete(contentItems).where(eq(contentItems.id, item.id));
  await tx
    .delete(slugRedirects)
    .where(or(eq(slugRedirects.fromPath, path), eq(slugRedirects.toPath, path)));

  if (wasLive) {
    await enqueueOutbox(
      tx,
      "content.changed",
      { itemId: null, kind: "unpublished", paths: [] as string[], oldPaths: [path] },
      `content.changed:${item.id}:purged`,
    );
  }

  return { type: item.type, locale: item.locale, slug: item.slug, path, wasLive };
}
