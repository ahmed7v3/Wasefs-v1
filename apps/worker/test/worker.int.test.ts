import { randomUUID } from "node:crypto";

import { WORKER_HEARTBEAT_KEY, workerStatus } from "@wasfa/shared/queues";
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";
import { createEmailRuntime } from "../src/notifications/email.js";
import { closeWorkers, registerSchedules, startWorkers, type WorkerSet } from "../src/queues.js";

import { testEnv } from "./support/env.js";
import { startRedis, type TestRedis } from "./support/redis.js";

let redisInfra: TestRedis;
let connection: Redis;
let set: WorkerSet;
let producer: Queue;

const logs: string[] = [];
const logger = createLogger(
  { NODE_ENV: "test", LOG_LEVEL: "info" },
  {
    write: (line: string) => {
      logs.push(line);
    },
  },
);

async function waitFor<T>(
  read: () => Promise<T | null | undefined | false>,
  ms = 15_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

beforeAll(async () => {
  redisInfra = await startRedis();
  connection = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
  const email = createEmailRuntime(testEnv(redisInfra.url), connection, logger);
  set = startWorkers(
    connection,
    { system: 2, notifications: 1 },
    { redis: connection, logger, email },
  );
  producer = new Queue("system", { connection });
  await registerSchedules(set.queues);
});

afterAll(async () => {
  await closeWorkers(set.workers, 5_000);
  await Promise.all([producer.close(), ...set.queues.map((queue) => queue.close())]);
  await connection.quit();
  await redisInfra.stop();
});

describe("system.heartbeat", () => {
  it("writes the heartbeat key at startup, and a manual job refreshes it", async () => {
    const first = await waitFor(() => connection.get(WORKER_HEARTBEAT_KEY));
    expect(workerStatus(first)).toBe("ok");

    await connection.set(WORKER_HEARTBEAT_KEY, "1");
    expect(workerStatus(await connection.get(WORKER_HEARTBEAT_KEY))).toBe("stale");
    await producer.add("system.heartbeat", { source: "manual" });
    const refreshed = await waitFor(async () => {
      const value = await connection.get(WORKER_HEARTBEAT_KEY);
      return value !== "1" ? value : null;
    });
    expect(workerStatus(refreshed)).toBe("ok");
  });

  it("is scheduled every 5 minutes, and re-registering does not duplicate it", async () => {
    await registerSchedules(set.queues);
    const schedulers = await producer.getJobSchedulers();
    const heartbeat = schedulers.filter((scheduler) => scheduler.key === "system.heartbeat");
    expect(heartbeat).toHaveLength(1);
    expect(heartbeat[0]?.every).toBe(300_000);
  });
});

describe("payload validation", () => {
  async function failedJob(name: string, data: unknown): Promise<Job> {
    const jobId = `test-${randomUUID()}`;
    await producer.add(name, data, { jobId });
    await waitFor(async () => (await producer.getJob(jobId))?.isFailed());
    // Re-read: the first snapshot may predate the failure.
    const job = await producer.getJob(jobId);
    if (job === undefined) throw new Error("job disappeared");
    return job;
  }

  it("rejects an invalid payload with a clear reason, without retrying and without the value", async () => {
    const job = await failedJob("system.heartbeat", { source: "ali@example.com" });
    expect(job.failedReason).toContain("Invalid payload for system.heartbeat");
    expect(job.failedReason).toContain("source");
    expect(job.failedReason).not.toContain("ali@example.com");
    // Default policy allows 3 attempts; a schema failure must not use them.
    expect(job.attemptsMade).toBe(1);
    expect(logs.join("")).toContain("Job failed");
  });

  it("rejects a job name that is not in the registry", async () => {
    const job = await failedJob("system.unknown", {});
    expect(job.failedReason).toContain('Unknown job "system.unknown"');
    expect(job.attemptsMade).toBe(1);
  });
});

describe("closeWorkers", () => {
  it("returns clean when workers close in time", async () => {
    const worker = { close: async () => undefined };
    await expect(closeWorkers([worker], 1_000)).resolves.toBe("clean");
  });

  it("force-closes workers whose active jobs outlive the timeout", async () => {
    const calls: (boolean | undefined)[] = [];
    const stuck = {
      close: (force?: boolean) => {
        calls.push(force);
        return force ? Promise.resolve() : new Promise<void>(() => undefined);
      },
    };
    await expect(closeWorkers([stuck], 100)).resolves.toBe("forced");
    expect(calls).toEqual([undefined, true]);
  });
});
