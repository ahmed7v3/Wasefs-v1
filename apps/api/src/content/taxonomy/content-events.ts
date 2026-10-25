import { enqueueOutbox, type Database, type Transaction } from "@wasfa/db";
import {
  CONTENT_CHANGED_TOPIC,
  contentChangedPayloadSchema,
  type ContentChangedPayload,
} from "@wasfa/shared/schemas/content";

/**
 * Writes the `content.changed` outbox event of a taxonomy/redirect change inside the caller's
 * transaction (the worker turns it into cache revalidation and IndexNow). Returns the idempotency
 * key so the service can `OutboxQueue.kick` it after the commit.
 */
export async function enqueueContentChanged(
  tx: Transaction | Database,
  kind: "taxonomy" | "redirects",
  subject: string,
  extra: Partial<Pick<ContentChangedPayload, "paths" | "oldPaths">> = {},
): Promise<string> {
  const payload = contentChangedPayloadSchema.parse({ itemId: null, kind, ...extra });
  const key = `${CONTENT_CHANGED_TOPIC}:${kind}:${subject}:${String(Date.now())}`;
  await enqueueOutbox(tx, CONTENT_CHANGED_TOPIC, payload, key);
  return key;
}
