import { randomUUID } from "node:crypto";

import { createDb } from "@wasfa/db";
import { WORKER_HEARTBEAT_KEY, workerStatus } from "@wasfa/shared/queues";
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";
import { createEmailRuntime } from "../src/notifications/email.js";
import {
  HANDLERS,
  closeWorkers,
  registerSchedules,
  startWorkers,
  type WorkerSet,
} from "../src/queues.js";

import { testEnv } from "./support/env.js";
import { startPostgres, type TestPostgres } from "./support/postgres.js";
import { startRedis, type TestRedis } from "./support/redis.js";

let redisInfra: TestRedis;
let postgres: TestPostgres;
let database: ReturnType<typeof createDb>;
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
  [redisInfra, postgres] = await Promise.all([startRedis(), startPostgres()]);
  database = createDb({ url: postgres.apiUrl, max: 2 });
  connection = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
  const email = createEmailRuntime(testEnv(redisInfra.url), connection, logger);
  set = startWorkers(
    connection,
    { system: 2, notifications: 1, credits: 1, images: 1, drugs: 1, rx: 1, evals: 1, payments: 1, seo: 1 },
    { redis: connection, db: database.db, logger, email },
  );
  producer = new Queue("system", { connection });
  await registerSchedules(set.queues);
});

afterAll(async () => {
  await closeWorkers(set.workers, 5_000);
  await Promise.all([producer.close(), ...set.queues.map((queue) => queue.close())]);
  await connection.quit();
  await database.close();
  await Promise.all([redisInfra.stop(), postgres.stop()]);
});

describe("system.heartbeat", () => {
  it("writes the heartbeat key at startup, and a manual job refreshes it", async () => {
    const first = await waitFor(() => connection.get(WORKER_HEARTBEAT_KEY));
    expect(workerStatus(first)).toBe("ok");

    // Not read back from Redis: the startup heartbeat can still land between the write and the read.
    expect(workerStatus("1")).toBe("stale");
    await connection.set(WORKER_HEARTBEAT_KEY, "1");
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

describe("account maintenance schedules", () => {
  it("has a handler for both jobs and schedules them hourly and every 6 hours, once each", async () => {
    expect(Object.keys(HANDLERS.system)).toEqual(
      expect.arrayContaining(["account.anonymize_due", "auth.purge_expired"]),
    );
    await registerSchedules(set.queues);
    const schedulers = await producer.getJobSchedulers();
    for (const [key, every] of [
      ["account.anonymize_due", 3_600_000],
      ["auth.purge_expired", 21_600_000],
    ] as const) {
      const matching = schedulers.filter((scheduler) => scheduler.key === key);
      expect(matching).toHaveLength(1);
      expect(matching[0]?.every).toBe(every);
    }
  });

  it("runs both jobs against the database when they are queued", async () => {
    await producer.add("account.anonymize_due", { source: "manual" }, { jobId: "t-anonymize" });
    await producer.add("auth.purge_expired", { source: "manual" }, { jobId: "t-purge" });
    await waitFor(async () => (await producer.getJob("t-anonymize"))?.isCompleted());
    await waitFor(async () => (await producer.getJob("t-purge"))?.isCompleted());
    const output = logs.join("");
    expect(output).toContain("Account anonymization run finished");
    expect(output).toContain("Expired sessions and verifications purged");
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

describe("credits maintenance", () => {
  it("has a handler for both jobs and schedules them every 5 minutes and daily at 00:10 UTC, once each", async () => {
    expect(Object.keys(HANDLERS.credits)).toEqual(
      expect.arrayContaining(["credits.sweep_reservations", "credits.grant_monthly"]),
    );
    await registerSchedules(set.queues);
    await registerSchedules(set.queues);
    const credits = set.queues.find((queue) => queue.name === "credits");
    const schedulers = (await credits?.getJobSchedulers()) ?? [];
    const sweep = schedulers.filter((scheduler) => scheduler.key === "credits.sweep_reservations");
    const grant = schedulers.filter((scheduler) => scheduler.key === "credits.grant_monthly");
    expect(sweep).toHaveLength(1);
    expect(sweep[0]?.every).toBe(300_000);
    expect(grant).toHaveLength(1);
    expect(grant[0]).toMatchObject({ pattern: "10 0 * * *", tz: "UTC" });
  });

  it("runs both jobs against the database when they are queued", async () => {
    const credits = set.queues.find((queue) => queue.name === "credits");
    await credits?.add("credits.sweep_reservations", {}, { jobId: "t-sweep" });
    await credits?.add("credits.grant_monthly", {}, { jobId: "t-grant" });
    await waitFor(async () => (await credits?.getJob("t-sweep"))?.isCompleted());
    await waitFor(async () => (await credits?.getJob("t-grant"))?.isCompleted());
    const output = logs.join("");
    expect(output).toContain("Expired credit reservations released");
    expect(output).toContain("Monthly credit grants finished");
  });
});

describe("image jobs", () => {
  it("has a handler for both jobs and schedules the retention daily at 03:30 UTC, once", async () => {
    expect(Object.keys(HANDLERS.images)).toEqual(
      expect.arrayContaining(["image.process", "files.retention"]),
    );
    await registerSchedules(set.queues);
    await registerSchedules(set.queues);
    const images = set.queues.find((queue) => queue.name === "images");
    const schedulers = (await images?.getJobSchedulers()) ?? [];
    const retention = schedulers.filter((scheduler) => scheduler.key === "files.retention");
    expect(retention).toHaveLength(1);
    expect(retention[0]).toMatchObject({ pattern: "30 3 * * *", tz: "UTC" });
  });

  it("rejects an image.process job without a valid fileId permanently, before any handler runs", async () => {
    const images = set.queues.find((queue) => queue.name === "images");
    await images?.add(
      "image.process",
      { fileId: "not-a-uuid" },
      { jobId: "t-bad-image", attempts: 1 },
    );
    await waitFor(async () => (await images?.getJob("t-bad-image"))?.isFailed());
    const job = await images?.getJob("t-bad-image");
    expect(job?.failedReason).toContain("fileId");
  });
});
