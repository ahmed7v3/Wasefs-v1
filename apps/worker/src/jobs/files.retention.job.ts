import { findExpired, markDeleted } from "./files.repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type RetentionContext = Pick<JobContext, "db" | "logger" | "storage">;

const BATCH = 200;
/** Batches per run, so one run cannot hold the queue for ever; the next daily run continues. */
const MAX_BATCHES = 50;

/** Every object a file may have left under its prefix (a failed delete of the original leaves one). */
function objectKeys(key: string): string[] {
  const prefix = key.slice(0, key.lastIndexOf("/"));
  return [...new Set([key, `${prefix}/original`, `${prefix}/original.pdf`, `${prefix}/processed`])];
}

/**
 * `files.retention` (daily): deletes the objects of files past `expires_at` and marks the rows
 * `deleted`; the analysis keeps its result and shows "the image was deleted". `expires_at` was set
 * from `uploads.retentionDays` when the file was created. Only counts are logged.
 */
export async function filesRetentionJob(
  _payload: JobPayload<"images", "files.retention">,
  { db, logger, storage }: RetentionContext,
): Promise<void> {
  if (storage === undefined) {
    logger.warn("Retention skipped: uploads storage is not configured");
    return;
  }
  let deleted = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const expired = await findExpired(db, new Date(), BATCH);
    if (expired.length === 0) break;
    for (const file of expired) {
      await Promise.all(objectKeys(file.r2Key).map((key) => storage.remove(key)));
      await markDeleted(db, file.id);
      deleted++;
    }
    if (expired.length < BATCH) break;
  }
  logger.info({ deleted }, "Expired upload objects deleted");
}
