import { parseEnv } from "@wasfa/shared/env";
import { z } from "zod";

import type { QueueName } from "@wasfa/shared/queues";

const concurrency = z.coerce.number().int().min(1).max(64).default(1);

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Jobs a single worker process runs in parallel on the `system` queue. */
  WORKER_CONCURRENCY_SYSTEM: concurrency,
  /** How long shutdown waits for active jobs before force-closing. */
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
});

export type WorkerEnv = z.output<typeof workerEnvSchema>;

/** Validates `process.env` (or `source`) at boot; prints bad key names and exits on failure. */
export function loadEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}

/** A `Record` over `QueueName`, so adding a queue to the registry fails to compile until it is configured. */
export function queueConcurrency(env: WorkerEnv): Record<QueueName, number> {
  return { system: env.WORKER_CONCURRENCY_SYSTEM };
}
