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

import { DeferJob } from "./defer.js";
import { heartbeatJob } from "./jobs/health.job.js";
import { emailSendJob, type EmailRuntime } from "./notifications/email.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

export interface JobContext {
  redis: Redis;
  logger: Logger;
  email: EmailRuntime;
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
  },
  notifications: {
    "email.send": emailSendJob,
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

/** Registers repeatable jobs. Upserting by id is idempotent, so restarts never duplicate them. */
export async function registerSchedules(queues: readonly Queue[]): Promise<void> {
  const system = queues.find((queue) => queue.name === "system");
  if (system === undefined) throw new Error("system queue is not registered");
  await system.upsertJobScheduler(
    "system.heartbeat",
    { every: HEARTBEAT_INTERVAL_MS },
    { name: "system.heartbeat", data: { source: "scheduler" } },
  );
  // Beat once now so the API sees a live worker without waiting for the first interval.
  await system.add("system.heartbeat", { source: "manual" });
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
