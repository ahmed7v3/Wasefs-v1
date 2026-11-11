import { enqueueOutbox } from "./outbox.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";
import type { PublishingWebhookEvent } from "@wasfa/shared/schemas/publishing-webhooks";

export const PUBLISHING_WEBHOOK_TOPIC = "publishing.webhook_event";

/** Adds a key-scoped webhook event to the caller's transaction. */
export function enqueuePublishingWebhookEvent(
  tx: Transaction | Database,
  payload: PublishingWebhookEvent,
  idempotencyKey: string,
): Promise<void> {
  return enqueueOutbox(tx, PUBLISHING_WEBHOOK_TOPIC, payload, idempotencyKey);
}
