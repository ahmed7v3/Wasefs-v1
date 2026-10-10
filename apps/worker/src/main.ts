import { Redis } from "ioredis";

import { loadEnv, queueConcurrency } from "./config/env.js";
import { createLogger } from "./logger.js";
import { createEmailRuntime } from "./notifications/email.js";
import { closeWorkers, registerSchedules, startWorkers } from "./queues.js";

const env = loadEnv();
const logger = createLogger(env);

// BullMQ's blocking commands must never be cut short, hence no per-request retry limit.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on("error", (error: Error) => {
  logger.error({ reason: error.message }, "Redis connection error");
});

const email = createEmailRuntime(env, connection, logger);
const { workers, queues } = startWorkers(connection, queueConcurrency(env), {
  redis: connection,
  logger,
  email,
});
await registerSchedules(queues);
logger.info(
  { queues: queues.map((queue) => queue.name), mailTransport: email.transport.kind },
  "Worker started",
);

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down: waiting for active jobs");
  const outcome = await closeWorkers(workers, env.WORKER_SHUTDOWN_TIMEOUT_MS);
  if (outcome === "forced") {
    logger.warn(
      { timeoutMs: env.WORKER_SHUTDOWN_TIMEOUT_MS },
      "Active jobs did not finish; forced",
    );
  }
  await Promise.all(queues.map((queue) => queue.close()));
  email.transport.close();
  await connection.quit().catch(() => {
    connection.disconnect();
  });
  logger.info("Worker stopped");
  process.exit(0);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.fatal(
    { reason: reason instanceof Error ? reason.message : String(reason) },
    "Unhandled rejection",
  );
  process.exit(1);
});
