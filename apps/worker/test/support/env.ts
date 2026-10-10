import { randomBytes } from "node:crypto";

import { workerEnvSchema, type WorkerEnv } from "../../src/config/env.js";

export const TEST_ENCRYPTION_KEY = randomBytes(32).toString("base64");

/** A valid worker env for tests: mail is captured in Redis, nothing leaves the machine. */
export function testEnv(redisUrl: string, overrides: Record<string, string> = {}): WorkerEnv {
  return workerEnvSchema.parse({
    NODE_ENV: "test",
    REDIS_URL: redisUrl,
    DATABASE_URL: "postgres://wasfa:test@127.0.0.1:5432/wasfa",
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    LOG_LEVEL: "info",
    ...overrides,
  });
}
