import { localDayBounds, planPublishDue, requiresMedicalReview } from "@wasfa/shared/content";

import { readSetting } from "../settings.js";

import { createPublishDueRepo, type PublishDueRepo } from "./publish-due.repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

/** Due items read per run; the rest wait for the next minute. */
export const PUBLISH_DUE_BATCH = 200;
/** A publish later than this after its schedule says so in the log (a worker outage, a cap deferral). */
export const LATE_AFTER_SECONDS = 300;

export interface PublishDueOutcome {
  published: string[];
  /** Approval no longer matched the current revision: reverted to draft, not published. */
  reverted: string[];
  /** Over the daily cap: still scheduled, picked up again once the next local day starts. */
  deferred: number;
}

/**
 * One run of the scheduled publish, inside a transaction the caller opened. Items are processed in
 * scheduled order up to the daily cap (counted from the local midnight of the content time zone, so
 * manual publishes count too). Each item is re-verified under its row lock: a second run, or a
 * concurrent manual publish, finds it no longer `scheduled` and does nothing.
 */
export async function runPublishDue(input: {
  repo: PublishDueRepo;
  now: Date;
  cap: number;
  timeZone: string;
}): Promise<PublishDueOutcome> {
  const { repo, now, cap, timeZone } = input;
  const outcome: PublishDueOutcome = { published: [], reverted: [], deferred: 0 };
  const due = await repo.dueScheduled(now, PUBLISH_DUE_BATCH);
  if (due.length === 0) return outcome;

  const publishedToday = await repo.publishedSince(localDayBounds(now, timeZone).start);
  const plan = planPublishDue({ due, publishedToday, cap });
  outcome.deferred = plan.deferred.length;
  const scheduledAt = new Map(due.map((item) => [item.id, item.scheduledAt]));

  for (const itemId of plan.publishNow) {
    const item = await repo.loadCandidate(itemId);
    if (item?.status !== "scheduled") continue;

    const needsReview = requiresMedicalReview({
      type: item.type,
      categoryRequiresReview: item.categoryRequiresReview,
    });
    const approvalMissing =
      item.currentRevisionId === null ||
      (needsReview && item.reviewedRevisionId !== item.currentRevisionId);
    if (approvalMissing) {
      await repo.revertToDraft(itemId, item.currentRevisionId, now);
      outcome.reverted.push(itemId);
      continue;
    }

    const due_at = scheduledAt.get(itemId);
    const lateSeconds = due_at ? Math.floor((now.getTime() - due_at.getTime()) / 1000) : 0;
    await repo.publish(
      itemId,
      now,
      lateSeconds > LATE_AFTER_SECONDS ? `late:${String(lateSeconds)}s` : undefined,
    );
    outcome.published.push(itemId);
  }
  return outcome;
}

type PublishDueContext = Pick<JobContext, "db" | "logger" | "payments">;

/** `content.publish-due`, every minute. Logs ids and counts only, never titles. */
export async function publishDueJob(
  _payload: JobPayload<"content", "content.publish-due">,
  { db, logger, payments }: PublishDueContext,
): Promise<void> {
  const { maxPublishesPerDay, timeZone } = await readSetting(db, "content");
  const now = new Date();
  const outcome = await db.transaction((tx) =>
    runPublishDue({ repo: createPublishDueRepo(tx), now, cap: maxPublishesPerDay, timeZone }),
  );
  if (outcome.published.length === 0 && outcome.reverted.length === 0 && outcome.deferred === 0) {
    return;
  }
  logger.info(
    {
      published: outcome.published.length,
      publishedIds: outcome.published,
      reverted: outcome.reverted,
      deferred: outcome.deferred,
    },
    "Scheduled content run finished",
  );
  // The outbox rows are committed; draining now purges the web cache within seconds instead of 30.
  if (outcome.published.length > 0 || outcome.reverted.length > 0) {
    try {
      await payments?.enqueueOutboxDrain();
    } catch (error) {
      logger.warn(
        { reason: error instanceof Error ? error.name : "error" },
        "Outbox drain could not be queued; the 30 s schedule picks the events up",
      );
    }
  }
}
