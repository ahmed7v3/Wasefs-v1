import { z } from "zod";

import { emailSendPayloadSchema } from "./email.js";

/**
 * Queue registry shared by `apps/api` (producers) and `apps/worker` (consumers).
 * Every job a queue accepts is listed here with the zod schema of its payload, so a producer
 * and the consumer can never disagree about the shape — and the worker rejects anything else.
 */

/** `system.heartbeat`: proves the worker is alive. `source` is for log filtering only. */
export const heartbeatPayloadSchema = z.object({
  source: z.enum(["scheduler", "manual"]).default("scheduler"),
});

export const QUEUE_REGISTRY = {
  system: {
    "system.heartbeat": heartbeatPayloadSchema,
  },
  notifications: {
    "email.send": emailSendPayloadSchema,
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
