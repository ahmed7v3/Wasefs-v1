import { z } from "zod";

import {
  customerMessagePayloadSchema,
  customerWhatsappCheckPayloadSchema,
} from "./customer-messages.js";
import { emailSendPayloadSchema } from "./email.js";
import { evalImportPayloadSchema, evalRunPayloadSchema } from "./schemas/admin-evals.js";
import { imageProcessPayloadSchema } from "./schemas/files.js";
import { rxAnalyzePayloadSchema } from "./schemas/rx.js";

/**
 * Queue registry shared by `apps/api` (producers) and `apps/worker` (consumers).
 * Every job a queue accepts is listed here with the zod schema of its payload, so a producer
 * and the consumer can never disagree about the shape — and the worker rejects anything else.
 */

/** `system.heartbeat`: proves the worker is alive. `source` is for log filtering only. */
export const heartbeatPayloadSchema = z.object({
  source: z.enum(["scheduler", "manual"]).default("scheduler"),
});

/**
 * Scheduled account maintenance (Task 1.7). No payload: each run picks up whatever is due.
 * `account.anonymize_due`: deletion requests older than the grace period, and never-verified
 * accounts older than their TTL. `auth.purge_expired`: expired sessions and verification rows.
 */
export const maintenancePayloadSchema = z.object({
  source: z.enum(["scheduler", "manual"]).default("scheduler"),
});

/**
 * Credit maintenance (Phase 2, Task 2.2). No payload: each run works out what is due.
 * `credits.sweep_reservations`: releases reservations whose job crashed. `credits.grant_monthly`:
 * gives every user the monthly credits of their plan for the current UTC month (once per period).
 * `credits.reconcile`: nightly check of every wallet balance against its ledger. `ai.spend_rollup`:
 * hourly recompute of `ai_spend_daily` (both on the `credits` queue: accounting, not AI calls).
 */
export const creditsMaintenancePayloadSchema = z.object({});

/**
 * Uploaded images (Phase 2, Task 2.5). `image.process` re-encodes one upload (`fileId`);
 * `files.retention` (no payload) deletes the objects older than `uploads.retentionDays`.
 */
export const filesRetentionPayloadSchema = z.object({});

/**
 * Payments (Phase 3, Task 3.3), all scheduled with no payload: `payments.reconcile` asks the
 * provider about open gateway payments, `payments.expire_orders` closes unpaid orders,
 * `payments.consistency` checks paid orders against payments and the credit ledger, and
 * `outbox.drain` runs the side effects committed with money changes (receipts, notifications).
 */
export const paymentsMaintenancePayloadSchema = z.object({});

/**
 * Drug list import (Phase 2, Task 2.7). The uploaded file waits in Redis (`drugimport:<batchId>`);
 * `dry_run` reports what a commit would do, `commit` writes it. Rollback is a plain api transaction.
 */
export const drugImportPayloadSchema = z.object({
  batchId: z.uuid(),
  mode: z.enum(["dry_run", "commit"]),
  /** The admin who asked, for `committed_by`. */
  actorId: z.uuid().optional(),
});

/** Most URLs one IndexNow request may carry in a single job (the protocol allows 10 000; we stay small). */
export const INDEXNOW_MAX_URLS = 100;

/** `seo.indexnow`: absolute https URLs that changed and should be announced to IndexNow. */
export const indexNowPayloadSchema = z.object({
  urls: z
    .array(z.url({ protocol: /^https$/ }))
    .min(1)
    .max(INDEXNOW_MAX_URLS),
});

export const QUEUE_REGISTRY = {
  system: {
    "system.heartbeat": heartbeatPayloadSchema,
    "account.anonymize_due": maintenancePayloadSchema,
    "auth.purge_expired": maintenancePayloadSchema,
  },
  notifications: {
    "email.send": emailSendPayloadSchema,
    "alerts.deliver": z.object({ deliveryId: z.uuid() }),
    "alerts.digest": z.object({
      adminUserId: z.uuid(),
      channel: z.enum(["email", "telegram", "whatsapp"]),
      windowStart: z.iso.datetime(),
    }),
    "alerts.sweep_pending": z.object({}),
    // Customer notifications: WhatsApp when the customer can get it there, else email.
    "customer.notify": customerMessagePayloadSchema,
    "customer.whatsapp_check": customerWhatsappCheckPayloadSchema,
  },
  credits: {
    "credits.sweep_reservations": creditsMaintenancePayloadSchema,
    "credits.grant_monthly": creditsMaintenancePayloadSchema,
    "credits.reconcile": creditsMaintenancePayloadSchema,
    "ai.spend_rollup": creditsMaintenancePayloadSchema,
  },
  images: {
    "image.process": imageProcessPayloadSchema,
    "files.retention": filesRetentionPayloadSchema,
    // Public media library (Phase 4): one asset per job. ":" is not allowed in BullMQ names, so `media.process`.
    "media.process": z.object({ assetId: z.uuid() }),
  },
  drugs: {
    "drugs.import": drugImportPayloadSchema,
  },
  /** Prescription analysis (Phase 2, Task 2.8): one job per analysis, jobId `rx-<id>`. */
  rx: {
    "rx.analyze": rxAnalyzePayloadSchema,
  },
  payments: {
    "payments.reconcile": paymentsMaintenancePayloadSchema,
    "payments.expire_orders": paymentsMaintenancePayloadSchema,
    "payments.consistency": paymentsMaintenancePayloadSchema,
    "outbox.drain": paymentsMaintenancePayloadSchema,
    "alerts.retention": paymentsMaintenancePayloadSchema,
    "payment-methods.apply-due": paymentsMaintenancePayloadSchema,
    "payments.review-sla": paymentsMaintenancePayloadSchema,
    "payments.failure_spike": paymentsMaintenancePayloadSchema,
    // Subscriptions (BILLING §7): period ends, grace, grants, reminders; and the paid-order backfill.
    "subscriptions.lifecycle": paymentsMaintenancePayloadSchema,
    "subscriptions.backfill": paymentsMaintenancePayloadSchema,
    "promotions.status": paymentsMaintenancePayloadSchema,
    // Rewards (Task 3.11): hourly release of pending points, nightly check of wallets against the ledger.
    "rewards.release": paymentsMaintenancePayloadSchema,
    "rewards.reconcile": paymentsMaintenancePayloadSchema,
    // Deals (Task 3.10): the monthly bonus credits of active organization deals, daily at 04:20 UTC.
    "deals.monthly_bonus": paymentsMaintenancePayloadSchema,
    // Conversion engine (Task 3.14): offers, lifecycle mail and taste credits hourly; retention nightly.
    "growth.lifecycle": paymentsMaintenancePayloadSchema,
    "growth.retention": paymentsMaintenancePayloadSchema,
    // Withdrawals (Task 3.12): overdue reminders every 30 minutes, nightly paid-out vs ledger check.
    "withdrawals.overdue": paymentsMaintenancePayloadSchema,
    "withdrawals.reconcile": paymentsMaintenancePayloadSchema,
  },
  /** Search discoverability (Phase 4): IndexNow pings. BullMQ names cannot contain ":", hence queue `seo`, job `seo.indexnow`. */
  seo: {
    "seo.indexnow": indexNowPayloadSchema,
  },
  /** Accuracy evaluation (Phase 2, Task 2.10): label-set imports and eval runs; no credits, no users. */
  evals: {
    "evals.run": evalRunPayloadSchema,
    "evals.import": evalImportPayloadSchema,
  },
} as const;

export type QueueRegistry = typeof QUEUE_REGISTRY;
export type QueueName = keyof QueueRegistry;
export type JobName<Q extends QueueName = QueueName> = keyof QueueRegistry[Q] & string;
/** Payload as a producer must send it (defaults not yet applied). */
export type JobInput<Q extends QueueName, J extends JobName<Q>> = z.input<QueueRegistry[Q][J]>;
/** Payload as the processor receives it (defaults applied). */
export type JobPayload<Q extends QueueName, J extends JobName<Q>> = z.output<QueueRegistry[Q][J]>;

export const QUEUE_NAMES = Object.keys(QUEUE_REGISTRY) as QueueName[];

export function isQueueName(value: string): value is QueueName {
  return Object.hasOwn(QUEUE_REGISTRY, value);
}

/** Retry policy applied to every job unless a producer overrides it. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  // Keep a bounded history so Redis cannot fill up with finished jobs.
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;

export type ParsedJob<Q extends QueueName, J extends JobName<Q>> =
  { ok: true; data: JobPayload<Q, J> } | { ok: false; reason: string };

/**
 * Validates a job payload against its registered schema. The failure `reason` lists the offending
 * field paths and zod issue codes only — never the values, which can contain personal data.
 */
export function parseJobPayload<Q extends QueueName, J extends JobName<Q>>(
  queue: Q,
  jobName: J,
  data: unknown,
): ParsedJob<Q, J> {
  const schemas: Record<string, z.ZodType> = QUEUE_REGISTRY[queue];
  const schema = Object.hasOwn(schemas, jobName) ? schemas[jobName] : undefined;
  if (schema === undefined) {
    return { ok: false, reason: `Unknown job "${String(jobName)}" for queue "${queue}"` };
  }
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return { ok: true, data: parsed.data as JobPayload<Q, J> };
  }
  const problems = parsed.error.issues.map(
    (issue) => `${issue.path.join(".") || "(root)"} (${issue.code})`,
  );
  return {
    ok: false,
    reason: `Invalid payload for ${String(jobName)}: ${problems.join(", ")}`,
  };
}

/** Redis key the worker refreshes; its value is the epoch-millisecond timestamp of the last beat. */
export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";
export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
/** Two missed beats: one late or restarted worker is tolerated, a dead one is not. */
export const HEARTBEAT_STALE_AFTER_MS = 10 * 60_000;

export type WorkerStatus = "ok" | "stale";

/** Tolerated clock difference between the worker and the API host. */
const CLOCK_SKEW_MS = 30_000;

/** `ok` when the stored heartbeat is recent; a missing, unparsable or far-future value is stale. */
export function workerStatus(stored: string | null, now: number = Date.now()): WorkerStatus {
  if (stored === null || !/^\d{1,16}$/.test(stored)) return "stale";
  const age = now - Number(stored);
  return age >= -CLOCK_SKEW_MS && age <= HEARTBEAT_STALE_AFTER_MS ? "ok" : "stale";
}
