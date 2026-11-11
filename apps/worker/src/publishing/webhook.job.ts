import { createHmac } from "node:crypto";

import { publishingWebhookDeliveries } from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { eq } from "drizzle-orm";

import { DeferJob } from "../defer.js";

import { postWebhook } from "./webhook-http.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 24 * 60 * 60_000;
const RETRIES_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000] as const;

export function webhookBackoffMs(attempt: number): number {
  return RETRIES_MS[Math.max(0, Math.min(RETRIES_MS.length - 1, attempt - 1))] ?? 12 * 60 * 60_000;
}

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function publishingWebhookJob(
  { deliveryId }: JobPayload<"notifications", "publishing.webhook">,
  { db, env, logger }: JobContext,
): Promise<void> {
  const row = (await db.select().from(publishingWebhookDeliveries).where(eq(publishingWebhookDeliveries.id, deliveryId)).limit(1))[0];
  if (!row || row.status === "succeeded" || row.status === "failed") return;
  const now = new Date();
  const attempts = row.attempts + 1;
  await db.update(publishingWebhookDeliveries).set({ attempts }).where(eq(publishingWebhookDeliveries.id, deliveryId));
  let status: number | null = null;
  let failure: string | null = null;
  try {
    if (!env) throw new Error("worker_env_missing");
    const key = decodeEncryptionKey(env.ENCRYPTION_KEY);
    const url = decryptSecret(row.webhookUrlEnc, key, "publishing:webhook:url");
    const secret = decryptSecret(row.webhookSecretEnc, key, "publishing:webhook:secret");
    const body = JSON.stringify(row.payload);
    const timestamp = String(Math.floor(now.getTime() / 1000));
    status = (await postWebhook(url, body, {
      "x-wasfa-event": row.event,
      "x-wasfa-delivery": row.id,
      "x-wasfa-timestamp": timestamp,
      "x-wasfa-signature": `v1=${webhookSignature(secret, timestamp, body)}`,
    })).status;
    if (status < 200 || status >= 300) failure = `http_${status}`;
  } catch (error) {
    failure = error instanceof Error ? error.name.slice(0, 100) : "delivery_error";
  }
  if (failure === null) {
    await db.update(publishingWebhookDeliveries).set({ status: "succeeded", responseStatus: status, error: null, deliveredAt: now, nextAttemptAt: now }).where(eq(publishingWebhookDeliveries.id, deliveryId));
    return;
  }
  const expired = now.getTime() - row.createdAt.getTime() >= WINDOW_MS;
  if (attempts >= MAX_ATTEMPTS || expired) {
    await db.update(publishingWebhookDeliveries).set({ status: "failed", responseStatus: status, error: failure, nextAttemptAt: now }).where(eq(publishingWebhookDeliveries.id, deliveryId));
    logger.warn({ deliveryId, event: row.event, attempts, responseStatus: status }, "Publishing webhook delivery failed");
    return;
  }
  const nextAttemptAt = new Date(Math.min(now.getTime() + webhookBackoffMs(attempts), row.createdAt.getTime() + WINDOW_MS));
  await db.update(publishingWebhookDeliveries).set({ status: "pending", responseStatus: status, error: failure, nextAttemptAt }).where(eq(publishingWebhookDeliveries.id, deliveryId));
  throw new DeferJob(nextAttemptAt.getTime(), failure);
}
