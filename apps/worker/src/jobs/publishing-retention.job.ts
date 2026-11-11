import {
  enqueuePublishingWebhookEvent,
  purgeExpiredPublishingIdempotency,
  purgeOlderThan,
  PUBLISHING_REQUEST_RETENTION_DAYS,
  publishingApiKeys,
} from "@wasfa/db";
import { and, gt, lte } from "drizzle-orm";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

const KEY_EXPIRING_WINDOW_MS = 14 * 86_400_000;

/** `publishing.retention`, daily: clear replay records after 24 hours and request logs after 90 days. */
export async function publishingRetentionJob(
  _payload: JobPayload<"payments", "publishing.retention">,
  { db, logger }: Pick<JobContext, "db" | "logger">,
  now = new Date(),
): Promise<void> {
  const idempotency = await purgeExpiredPublishingIdempotency(db, now);
  const requests = await purgeOlderThan(db, PUBLISHING_REQUEST_RETENTION_DAYS, now);
  const expiringBefore = new Date(now.getTime() + KEY_EXPIRING_WINDOW_MS);
  const expiring = await db
    .select({ id: publishingApiKeys.id, expiresAt: publishingApiKeys.expiresAt })
    .from(publishingApiKeys)
    .where(and(gt(publishingApiKeys.expiresAt, now), lte(publishingApiKeys.expiresAt, expiringBefore)));
  for (const key of expiring) {
    await enqueuePublishingWebhookEvent(
      db,
      { keyId: key.id, itemId: null, mediaId: null, event: "key.expiring", comment: null },
      `publishing.webhook:${key.id}:expiring:${key.expiresAt.toISOString().slice(0, 10)}`,
    );
  }
  logger.info({ idempotency, requests, expiring: expiring.length }, "Publishing API records past retention deleted");
}
