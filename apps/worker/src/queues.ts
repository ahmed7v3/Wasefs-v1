import {
  DEFAULT_JOB_OPTIONS,
  HEARTBEAT_INTERVAL_MS,
  QUEUE_NAMES,
  parseJobPayload,
  type JobName,
  type JobPayload,
  type QueueName,
} from "@wasfa/shared/queues";
import { DelayedError, Queue, UnrecoverableError, Worker, type Job } from "bullmq";

import { alertDeliveryJob } from "./alerts/alert-delivery.job.js";
import { alertDigestJob } from "./alerts/alert-digest.job.js";
import { pendingDeliverySweepJob } from "./alerts/pending-delivery-sweep.job.js";
import { brandingIconsJob } from "./branding/branding.job.js";
import { publishDueJob } from "./content/publish-due.job.js";
import { DeferJob } from "./defer.js";
import { anonymizeDueJob, purgeExpiredJob } from "./jobs/accounts.job.js";
import { spendRollupJob } from "./jobs/ai.spend-rollup.job.js";
import { alertsRetentionJob } from "./jobs/alerts-retention.job.js";
import { grantMonthlyJob } from "./jobs/credits.grant.job.js";
import { reconcileCreditsJob } from "./jobs/credits.reconcile.job.js";
import { sweepReservationsJob } from "./jobs/credits.sweep.job.js";
import { dealsMonthlyBonusJob } from "./jobs/deals.job.js";
import { drugImportJob } from "./jobs/drug-import.job.js";
import { evalImportJob, evalRunJob } from "./jobs/eval.job.js";
import { filesRetentionJob } from "./jobs/files.retention.job.js";
import { growthLifecycleJob, growthRetentionJob } from "./jobs/growth.job.js";
import { heartbeatJob } from "./jobs/health.job.js";
import { imageProcessJob } from "./jobs/image.job.js";
import { drainOutboxJob } from "./jobs/outbox.job.js";
import { applyDuePaymentMethodChangesJob } from "./jobs/payment-method-account-changes.job.js";
import { paymentsFailureSpikeJob } from "./jobs/payments-failure-spike.job.js";
import { paymentsReviewSlaJob } from "./jobs/payments-review-sla.job.js";
import {
  expireOrdersJob,
  paymentsConsistencyJob,
  reconcilePaymentsJob,
} from "./jobs/payments.job.js";
import { promotionsStatusJob } from "./jobs/promotions.job.js";
import { reconcileRewardsJob, releaseRewardsJob } from "./jobs/rewards.job.js";
import { rxAnalyzeJob } from "./jobs/rx.job.js";
import { indexNowJob } from "./jobs/seo.indexnow.job.js";
import { subscriptionsBackfillJob, subscriptionsLifecycleJob } from "./jobs/subscriptions.job.js";
import { withdrawalsOverdueJob, withdrawalsReconcileJob } from "./jobs/withdrawals.job.js";
import { mediaProcessJob } from "./media/media.job.js";
import { customerNotifyJob, customerWhatsappCheckJob } from "./notifications/customer.job.js";
import { emailSendJob, type EmailRuntime } from "./notifications/email.js";
import { ogRenderJob } from "./og/og.job.js";

import type { AiRuntime } from "./ai/runtime.js";
import type { PaymentsRuntime } from "./payments/runtime.js";
import type { ObjectStore } from "./storage/object-store.js";
import type { Database } from "@wasfa/db";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

export interface JobContext {
  redis: Redis;
  db: Database;
  logger: Logger;
  email: EmailRuntime;
  /** The uploads bucket; unset when `R2_UPLOADS_*` are not configured (image jobs then fail loudly). */
  storage?: ObjectStore | undefined;
  /** The PUBLIC media bucket (`R2_MEDIA_BUCKET`); unset when media is not configured (media jobs then fail loudly). */
  media?: ObjectStore | undefined;
  /** The AI router (providers, breaker, spend guard); the `rx` queue needs it. */
  ai?: AiRuntime | undefined;
  /** Provider adapters, hooks and mail for the `payments` queue. */
  payments?: PaymentsRuntime | undefined;
  env?: import("./config/env.js").WorkerEnv | undefined;
}

type JobHandler<Q extends QueueName, J extends JobName<Q>> = (
  payload: JobPayload<Q, J>,
  context: JobContext,
) => Promise<void>;

/** Exhaustive over the shared registry: a job without a handler (or vice versa) fails to compile. */
type Handlers = { [Q in QueueName]: { [J in JobName<Q>]: JobHandler<Q, J> } };

export const HANDLERS: Handlers = {
  system: {
    "system.heartbeat": heartbeatJob,
    "account.anonymize_due": anonymizeDueJob,
    "auth.purge_expired": purgeExpiredJob,
  },
  notifications: {
    "email.send": emailSendJob,
    "alerts.deliver": alertDeliveryJob,
    "alerts.digest": alertDigestJob,
    "alerts.sweep_pending": pendingDeliverySweepJob,
    "customer.notify": customerNotifyJob,
    "customer.whatsapp_check": customerWhatsappCheckJob,
  },
  credits: {
    "credits.sweep_reservations": sweepReservationsJob,
    "credits.grant_monthly": grantMonthlyJob,
    "credits.reconcile": reconcileCreditsJob,
    "ai.spend_rollup": spendRollupJob,
  },
  drugs: {
    "drugs.import": drugImportJob,
  },
  images: {
    "image.process": imageProcessJob,
    "files.retention": filesRetentionJob,
    "media.process": mediaProcessJob,
    "og.render": ogRenderJob,
    "branding.icons": brandingIconsJob,
  },
  rx: {
    "rx.analyze": rxAnalyzeJob,
  },
  seo: {
    "seo.indexnow": indexNowJob,
  },
  content: {
    "content.publish-due": publishDueJob,
  },
  evals: {
    "evals.run": evalRunJob,
    "evals.import": evalImportJob,
  },
  payments: {
    "payments.reconcile": reconcilePaymentsJob,
    "payments.expire_orders": expireOrdersJob,
    "payments.consistency": paymentsConsistencyJob,
    "outbox.drain": drainOutboxJob,
    "alerts.retention": alertsRetentionJob,
    "payment-methods.apply-due": applyDuePaymentMethodChangesJob,
    "payments.review-sla": paymentsReviewSlaJob,
    "payments.failure_spike": paymentsFailureSpikeJob,
    "subscriptions.lifecycle": subscriptionsLifecycleJob,
    "subscriptions.backfill": subscriptionsBackfillJob,
    "promotions.status": promotionsStatusJob,
    "rewards.release": releaseRewardsJob,
    "rewards.reconcile": reconcileRewardsJob,
    "withdrawals.overdue": withdrawalsOverdueJob,
    "withdrawals.reconcile": withdrawalsReconcileJob,
    "deals.monthly_bonus": dealsMonthlyBonusJob,
    "growth.lifecycle": growthLifecycleJob,
    "growth.retention": growthRetentionJob,
  },
};

/**
 * Builds the processor for one queue. The payload is validated against the shared schema BEFORE
 * any handler runs; an invalid or unknown job fails permanently (no retries) with a reason that
 * names the bad fields but never their values. A handler may throw `DeferJob` to wait without
 * using a retry (BullMQ's delayed-job protocol).
 */
export function createProcessor(
  queue: QueueName,
  context: JobContext,
): (job: Job, token?: string) => Promise<void> {
  const handlers: Record<
    string,
    ((payload: never, context: JobContext) => Promise<void>) | undefined
  > = HANDLERS[queue];
  return async (job, token) => {
    const handler = Object.hasOwn(handlers, job.name) ? handlers[job.name] : undefined;
    const parsed = parseJobPayload(queue, job.name as JobName<typeof queue>, job.data);
    if (handler === undefined || !parsed.ok) {
      throw new UnrecoverableError(
        parsed.ok ? `Unknown job "${job.name}" for queue "${queue}"` : parsed.reason,
      );
    }
    try {
      await handler(parsed.data as never, context);
    } catch (error) {
      if (error instanceof DeferJob && token !== undefined) {
        await job.moveToDelayed(error.until, token);
        throw new DelayedError();
      }
      throw error;
    }
  };
}

export interface WorkerSet {
  workers: Worker[];
  queues: Queue[];
}

/** Starts one BullMQ worker per registered queue and wires failure logging. */
export function startWorkers(
  connection: Redis,
  concurrency: Record<QueueName, number>,
  context: JobContext,
): WorkerSet {
  const { logger } = context;
  const queues = QUEUE_NAMES.map(
    (name) => new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
  );
  const workers = QUEUE_NAMES.map((name) => {
    const worker = new Worker(name, createProcessor(name, context), {
      connection,
      concurrency: concurrency[name],
    });
    worker.on("failed", (job, error) => {
      logger.warn(
        {
          queue: name,
          jobId: job?.id,
          jobName: job?.name,
          attemptsMade: job?.attemptsMade,
          reason: error.message,
        },
        "Job failed",
      );
    });
    worker.on("error", (error) => {
      logger.error({ queue: name, reason: error.message }, "Worker error");
    });
    return worker;
  });
  return { workers, queues };
}

const ANONYMIZE_INTERVAL_MS = 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const SWEEP_RESERVATIONS_INTERVAL_MS = 5 * 60 * 1000;
/** Daily at 00:10 UTC: just after the month turns, and every day after for late joiners and retries. */
export const GRANT_MONTHLY_PATTERN = "10 0 * * *";
/** Nightly at 02:00 UTC, after the grants and the day's last sweeps. */
export const RECONCILE_PATTERN = "0 2 * * *";
const SPEND_ROLLUP_INTERVAL_MS = 60 * 60 * 1000;
/** Daily at 03:30 UTC: deletes uploaded images past their retention. */
export const FILES_RETENTION_PATTERN = "30 3 * * *";

/** Scheduled content goes live within a minute of its time. */
const CONTENT_PUBLISH_DUE_INTERVAL_MS = 60_000;

/** BILLING §5.6: open gateway payments are asked about every 5 minutes. */
const PAYMENTS_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const PAYMENTS_EXPIRE_INTERVAL_MS = 5 * 60 * 1000;
/** Nightly at 02:20 UTC, after the credits reconcile. */
export const PAYMENTS_CONSISTENCY_PATTERN = "20 2 * * *";
/** Receipts and notifications should follow a payment within seconds. */
const OUTBOX_DRAIN_INTERVAL_MS = 30 * 1000;
const ALERT_RETENTION_PATTERN = "15 2 * * *";
const PAYMENT_METHOD_APPLY_INTERVAL_MS = 60_000;
const PAYMENT_REVIEW_SLA_INTERVAL_MS = 30 * 60_000;
const PAYMENTS_FAILURE_SPIKE_INTERVAL_MS = 5 * 60_000;
/** Period ends, grace and anniversary grants are due at any minute; reminders count in days. */
const SUBSCRIPTIONS_LIFECYCLE_INTERVAL_MS = 15 * 60_000;
/** Nightly at 02:40 UTC: paid subscription orders that still have no period (also run at start). */
const SUBSCRIPTIONS_BACKFILL_PATTERN = "40 2 * * *";
const PROMOTIONS_STATUS_INTERVAL_MS = 60_000;
/** Hourly at minute 7: pending rewards whose hold ended move to cash or credit-only (REFERRALS §4). */
export const REWARDS_RELEASE_PATTERN = "7 * * * *";
/** Nightly at 03:10 UTC: wallet buckets against the points ledger. */
export const REWARDS_RECONCILE_PATTERN = "10 3 * * *";
/** Every 30 minutes: withdrawals past `payoutSlaHours` are re-announced inside business hours. */
const WITHDRAWALS_OVERDUE_INTERVAL_MS = 30 * 60_000;
/** Nightly at 03:30 UTC: paid-out requests against the points ledger. */
export const WITHDRAWALS_RECONCILE_PATTERN = "30 3 * * *";

/** Daily at 04:20 UTC: the monthly bonus credits of active organization deals (REFERRALS §7.2). */
export const DEALS_MONTHLY_BONUS_PATTERN = "20 4 * * *";

/** Hourly at minute 25: personal offers, lifecycle mail and taste credits (GROWTH §6). */
export const GROWTH_LIFECYCLE_PATTERN = "25 * * * *";
/** Nightly at 04:40 UTC: growth events and the mail log past 13 months. */
export const GROWTH_RETENTION_PATTERN = "40 4 * * *";

/** Registers repeatable jobs. Upserting by id is idempotent, so restarts never duplicate them. */
export async function registerSchedules(queues: readonly Queue[]): Promise<void> {
  const system = queues.find((queue) => queue.name === "system");
  if (system === undefined) throw new Error("system queue is not registered");
  await system.upsertJobScheduler(
    "system.heartbeat",
    { every: HEARTBEAT_INTERVAL_MS },
    { name: "system.heartbeat", data: { source: "scheduler" } },
  );
  await system.upsertJobScheduler(
    "account.anonymize_due",
    { every: ANONYMIZE_INTERVAL_MS },
    { name: "account.anonymize_due", data: { source: "scheduler" } },
  );
  await system.upsertJobScheduler(
    "auth.purge_expired",
    { every: PURGE_INTERVAL_MS },
    { name: "auth.purge_expired", data: { source: "scheduler" } },
  );
  const credits = queues.find((queue) => queue.name === "credits");
  if (credits === undefined) throw new Error("credits queue is not registered");
  await credits.upsertJobScheduler(
    "credits.sweep_reservations",
    { every: SWEEP_RESERVATIONS_INTERVAL_MS },
    { name: "credits.sweep_reservations", data: {} },
  );
  const notifications = queues.find((queue) => queue.name === "notifications");
  if (notifications === undefined) throw new Error("notifications queue is not registered");
  await notifications.upsertJobScheduler(
    "alerts.sweep_pending",
    { every: 60_000 },
    { name: "alerts.sweep_pending", data: {} },
  );
  await credits.upsertJobScheduler(
    "credits.grant_monthly",
    { pattern: GRANT_MONTHLY_PATTERN, tz: "UTC" },
    { name: "credits.grant_monthly", data: {} },
  );
  await credits.upsertJobScheduler(
    "credits.reconcile",
    { pattern: RECONCILE_PATTERN, tz: "UTC" },
    { name: "credits.reconcile", data: {} },
  );
  await credits.upsertJobScheduler(
    "ai.spend_rollup",
    { every: SPEND_ROLLUP_INTERVAL_MS },
    { name: "ai.spend_rollup", data: {} },
  );
  const images = queues.find((queue) => queue.name === "images");
  if (images === undefined) throw new Error("images queue is not registered");
  await images.upsertJobScheduler(
    "files.retention",
    { pattern: FILES_RETENTION_PATTERN, tz: "UTC" },
    { name: "files.retention", data: {} },
  );
  const content = queues.find((queue) => queue.name === "content");
  if (content === undefined) throw new Error("content queue is not registered");
  await content.upsertJobScheduler(
    "content-publish-due",
    { every: CONTENT_PUBLISH_DUE_INTERVAL_MS },
    { name: "content.publish-due", data: {} },
  );
  // Beat once now so the API sees a live worker without waiting for the first interval.
  await system.add("system.heartbeat", { source: "manual" });
  const payments = queues.find((queue) => queue.name === "payments");
  if (payments === undefined) throw new Error("payments queue is not registered");
  await payments.upsertJobScheduler(
    "payments.reconcile",
    { every: PAYMENTS_RECONCILE_INTERVAL_MS },
    { name: "payments.reconcile", data: {} },
  );
  await payments.upsertJobScheduler(
    "payment-methods.apply-due",
    { every: PAYMENT_METHOD_APPLY_INTERVAL_MS },
    { name: "payment-methods.apply-due", data: {} },
  );
  await payments.upsertJobScheduler(
    "payments.review-sla",
    { every: PAYMENT_REVIEW_SLA_INTERVAL_MS },
    { name: "payments.review-sla", data: {} },
  );
  await payments.upsertJobScheduler(
    "payments.failure_spike",
    { every: PAYMENTS_FAILURE_SPIKE_INTERVAL_MS },
    { name: "payments.failure_spike", data: {} },
  );
  await payments.upsertJobScheduler(
    "alerts.retention",
    { pattern: ALERT_RETENTION_PATTERN, tz: "UTC" },
    { name: "alerts.retention", data: {} },
  );
  await payments.upsertJobScheduler(
    "payments.expire_orders",
    { every: PAYMENTS_EXPIRE_INTERVAL_MS },
    { name: "payments.expire_orders", data: {} },
  );
  await payments.upsertJobScheduler(
    "payments.consistency",
    { pattern: PAYMENTS_CONSISTENCY_PATTERN, tz: "UTC" },
    { name: "payments.consistency", data: {} },
  );
  await payments.upsertJobScheduler(
    "outbox.drain",
    { every: OUTBOX_DRAIN_INTERVAL_MS },
    { name: "outbox.drain", data: {} },
  );
  await payments.upsertJobScheduler(
    "subscriptions.lifecycle",
    { every: SUBSCRIPTIONS_LIFECYCLE_INTERVAL_MS },
    { name: "subscriptions.lifecycle", data: {} },
  );
  await payments.upsertJobScheduler(
    "promotions.status",
    { every: PROMOTIONS_STATUS_INTERVAL_MS },
    { name: "promotions.status", data: {} },
  );
  await payments.upsertJobScheduler(
    "rewards.release",
    { pattern: REWARDS_RELEASE_PATTERN, tz: "UTC" },
    { name: "rewards.release", data: {} },
  );
  await payments.upsertJobScheduler(
    "rewards.reconcile",
    { pattern: REWARDS_RECONCILE_PATTERN, tz: "UTC" },
    { name: "rewards.reconcile", data: {} },
  );
  await payments.upsertJobScheduler(
    "deals.monthly_bonus",
    { pattern: DEALS_MONTHLY_BONUS_PATTERN, tz: "UTC" },
    { name: "deals.monthly_bonus", data: {} },
  );
  await payments.upsertJobScheduler(
    "growth.lifecycle",
    { pattern: GROWTH_LIFECYCLE_PATTERN, tz: "UTC" },
    { name: "growth.lifecycle", data: {} },
  );
  await payments.upsertJobScheduler(
    "growth.retention",
    { pattern: GROWTH_RETENTION_PATTERN, tz: "UTC" },
    { name: "growth.retention", data: {} },
  );
  await payments.upsertJobScheduler(
    "withdrawals.overdue",
    { every: WITHDRAWALS_OVERDUE_INTERVAL_MS },
    { name: "withdrawals.overdue", data: {} },
  );
  await payments.upsertJobScheduler(
    "withdrawals.reconcile",
    { pattern: WITHDRAWALS_RECONCILE_PATTERN, tz: "UTC" },
    { name: "withdrawals.reconcile", data: {} },
  );
  await payments.upsertJobScheduler(
    "subscriptions.backfill",
    { pattern: SUBSCRIPTIONS_BACKFILL_PATTERN, tz: "UTC" },
    { name: "subscriptions.backfill", data: {} },
  );
  // Once at start too: orders paid while the activation hook was a no-op get their period now.
  await payments.add("subscriptions.backfill", {});
}

interface Closable {
  close: (force?: boolean) => Promise<void>;
}

/**
 * Waits for active jobs to finish. After `timeoutMs` the workers are force-closed so a stuck job
 * cannot block a deploy; BullMQ then returns the job to the queue as stalled and it is retried.
 */
export async function closeWorkers(
  workers: readonly Closable[],
  timeoutMs: number,
): Promise<"clean" | "forced"> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"forced">((resolve) => {
    timer = setTimeout(() => {
      resolve("forced");
    }, timeoutMs);
  });
  const drained = Promise.all(workers.map((worker) => worker.close())).then(() => "clean" as const);
  try {
    const outcome = await Promise.race([drained, timedOut]);
    if (outcome === "forced") {
      await Promise.all(workers.map((worker) => worker.close(true)));
    }
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}
