import { describe, expect, it } from "vitest";

import { queueConcurrency, workerEnvSchema } from "../src/config/env.js";

describe("workerEnvSchema", () => {
  it("applies defaults", () => {
    const env = workerEnvSchema.parse({ REDIS_URL: "redis://localhost:6379" });
    expect(env.WORKER_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    expect(queueConcurrency(env)).toEqual({ system: 1 });
  });

  it("reads concurrency per queue from the environment", () => {
    const env = workerEnvSchema.parse({
      REDIS_URL: "redis://localhost:6379",
      WORKER_CONCURRENCY_SYSTEM: "4",
    });
    expect(queueConcurrency(env).system).toBe(4);
  });

  it("rejects a missing or non-redis URL and out-of-range concurrency", () => {
    expect(workerEnvSchema.safeParse({}).success).toBe(false);
    expect(workerEnvSchema.safeParse({ REDIS_URL: "http://localhost" }).success).toBe(false);
    expect(
      workerEnvSchema.safeParse({
        REDIS_URL: "redis://localhost",
        WORKER_CONCURRENCY_SYSTEM: "0",
      }).success,
    ).toBe(false);
  });
});
