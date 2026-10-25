import {
  contentCategories,
  contentItems,
  contentPublishLog,
  countPublishedSince,
  dueScheduledItems,
  publishItemTx,
  type ContentActor,
  type Transaction,
} from "@wasfa/db";
import { eq } from "drizzle-orm";

import type { ContentType } from "@wasfa/shared/content/constants";

/*
 * Queries of the scheduled-publish job. The worker has no per-user scope: it acts as the `system`
 * actor on the items the schema says are due. Everything runs in the transaction the caller opened,
 * so the row locks taken by `dueScheduledItems` (SKIP LOCKED) hold until the whole run commits.
 */

export const SCHEDULER_ACTOR: ContentActor = { type: "system", id: null, name: "scheduler" };

export interface DueItem {
  id: string;
  scheduledAt: Date;
}

/** What the approval re-check needs, read under the row lock. */
export interface PublishCandidate {
  id: string;
  status: string;
  type: ContentType;
  categoryRequiresReview: boolean | null;
  currentRevisionId: string | null;
  reviewedRevisionId: string | null;
}

/** The calls the orchestration makes; a fake implements this in unit tests. */
export interface PublishDueRepo {
  dueScheduled(now: Date, limit: number): Promise<DueItem[]>;
  publishedSince(since: Date): Promise<number>;
  loadCandidate(itemId: string): Promise<PublishCandidate | null>;
  /** Scheduled item whose approval no longer matches: back to draft, schedule cleared, logged. */
  revertToDraft(itemId: string, revisionId: string | null, now: Date): Promise<void>;
  publish(itemId: string, now: Date, reason: string | undefined): Promise<void>;
}

export function createPublishDueRepo(tx: Transaction): PublishDueRepo {
  return {
    dueScheduled: (now, limit) => dueScheduledItems(tx, now, limit),
    publishedSince: (since) => countPublishedSince(tx, since),
    async loadCandidate(itemId) {
      const [row] = await tx
        .select({
          id: contentItems.id,
          status: contentItems.status,
          type: contentItems.type,
          categoryRequiresReview: contentCategories.requiresMedicalReview,
          currentRevisionId: contentItems.currentRevisionId,
          reviewedRevisionId: contentItems.reviewedRevisionId,
        })
        .from(contentItems)
        .leftJoin(contentCategories, eq(contentCategories.id, contentItems.categoryId))
        .where(eq(contentItems.id, itemId))
        .limit(1)
        // Same lock publishItemTx takes: a concurrent edit or manual publish waits for this run.
        .for("update", { of: contentItems });
      return row ?? null;
    },
    async revertToDraft(itemId, revisionId, now) {
      await tx
        .update(contentItems)
        .set({ status: "draft", scheduledAt: null, updatedAt: now })
        .where(eq(contentItems.id, itemId));
      await tx.insert(contentPublishLog).values({
        itemId,
        revisionId,
        fromStatus: "scheduled",
        toStatus: "draft",
        actorType: SCHEDULER_ACTOR.type,
        actorId: SCHEDULER_ACTOR.id,
        actorName: SCHEDULER_ACTOR.name,
        reason: "approval_missing_at_publish_time",
        at: now,
      });
    },
    async publish(itemId, now, reason) {
      await publishItemTx(tx, {
        itemId,
        actor: SCHEDULER_ACTOR,
        now,
        ...(reason === undefined ? {} : { reason }),
      });
    },
  };
}
