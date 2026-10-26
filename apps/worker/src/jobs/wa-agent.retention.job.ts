import {
  deleteEmptyConversationsOlderThan,
  deleteMessages,
  listMessagesForRetention,
} from "@wasfa/db";

import { readSetting } from "../settings.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type RetentionContext = Pick<JobContext, "db" | "logger" | "storage">;

const BATCH = 200;
/** Batches per run, so one run cannot hold the queue for ever; the next nightly run continues. */
const MAX_BATCHES = 50;
const DAY_MS = 86_400_000;

/**
 * `wa-agent.retention` (nightly): deletes WhatsApp agent messages older than `waAgent.retentionDays`
 * with their media objects, then the conversations that have nothing left and were quiet for as long.
 * Runs whether or not the agent is on: switching it off must not keep transcripts for ever. A media
 * object is removed before its row, so a failed delete is retried the next night instead of leaking.
 * Only counts are logged.
 */
export async function waAgentRetentionJob(
  _payload: JobPayload<"payments", "wa-agent.retention">,
  { db, logger, storage }: RetentionContext,
  now = new Date(),
): Promise<void> {
  const { retentionDays } = await readSetting(db, "waAgent");
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  let messages = 0;
  let media = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const old = await listMessagesForRetention(db, cutoff, BATCH);
    if (old.length === 0) break;
    const keys = old.flatMap((row) => (row.mediaKey === null ? [] : [row.mediaKey]));
    if (keys.length > 0) {
      if (storage === undefined) {
        // Never delete the row that is the only pointer to a stored object.
        logger.warn("WhatsApp agent retention stopped: uploads storage is not configured");
        break;
      }
      await Promise.all(keys.map((key) => storage.remove(key)));
      media += keys.length;
    }
    messages += await deleteMessages(
      db,
      old.map((row) => row.id),
    );
    if (old.length < BATCH) break;
  }
  const conversations = await deleteEmptyConversationsOlderThan(db, cutoff);
  logger.info({ messages, media, conversations }, "WhatsApp agent data past retention deleted");
}
