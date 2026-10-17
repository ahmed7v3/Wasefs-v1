import {
  NO_SUBSCRIPTION_HOOKS,
  configuredGateway,
  type Database,
  type PaymentHooks,
} from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { emailSendPayloadSchema, type EmailSendInput } from "@wasfa/shared/email";
import {
  FAKE_GATEWAY_DEV_SECRET,
  createFakeGateway,
  gatewayCredentialsContext,
  gatewayFromConfig,
  type PaymentGateway,
} from "@wasfa/shared/gateways";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { Queue } from "bullmq";

import type { WorkerEnv } from "../config/env.js";
import type { Redis } from "ioredis";

/** What the payments jobs need beyond the database: provider adapters, hooks, mail, links. */
export interface PaymentsRuntime {
  gateway(key: string): Promise<PaymentGateway | null>;
  /** Same binding as the api's `PAYMENT_HOOKS` (Task 3.5 replaces both with the subscriptions hooks). */
  hooks: PaymentHooks;
  webOrigin: string;
  /** Queues a mail; `jobId` makes a repeated call (outbox retry) a no-op while the job exists. */
  enqueueEmail(payload: EmailSendInput, jobId: string): Promise<void>;
  enqueueAlertDelivery(deliveryId: string, jobId: string): Promise<void>;
  enqueueAlertDigest(
    input: {
      adminUserId: string;
      channel: "email" | "telegram" | "whatsapp";
      windowStart: string;
    },
    delayMs: number,
  ): Promise<void>;
  close(): Promise<void>;
}

export function createPaymentsRuntime(
  env: WorkerEnv,
  db: Database,
  connection: Redis,
): PaymentsRuntime {
  const key = decodeEncryptionKey(env.ENCRYPTION_KEY);
  const fake = env.NODE_ENV === "production" ? null : createFakeGateway(FAKE_GATEWAY_DEV_SECRET);
  const notifications = new Queue("notifications", {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  return {
    async gateway(gatewayKey) {
      if (gatewayKey === "fake") return fake;
      const row = await configuredGateway(db, gatewayKey);
      if (!row?.credentialsEnc) return null;
      try {
        return gatewayFromConfig({
          provider: row.provider,
          mode: row.mode,
          credentials: decryptSecret(row.credentialsEnc, key, gatewayCredentialsContext(row.key)),
        });
      } catch {
        return null;
      }
    },
    hooks: NO_SUBSCRIPTION_HOOKS,
    webOrigin: env.WEB_ORIGIN,
    async enqueueEmail(payload, jobId) {
      await notifications.add("email.send", emailSendPayloadSchema.parse(payload), { jobId });
    },
    async enqueueAlertDelivery(deliveryId, jobId) {
      await notifications.add("alerts.deliver", { deliveryId }, { jobId });
    },
    async enqueueAlertDigest(input, delayMs) {
      const jobId = `alert-digest-${input.adminUserId}-${input.channel}-${Date.parse(input.windowStart)}`;
      await notifications.add("alerts.digest", input, { jobId, delay: Math.max(1, delayMs) });
    },
    async close() {
      await notifications.close();
    },
  };
}
