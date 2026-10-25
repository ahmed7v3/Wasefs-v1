import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { queueConcurrency, workerEnvSchema } from "../src/config/env.js";

const base = {
  REDIS_URL: "redis://localhost:6379",
  DATABASE_URL: "postgres://wasfa_api:secret@postgres:5432/wasfa",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

describe("workerEnvSchema", () => {
  it("applies defaults", () => {
    const env = workerEnvSchema.parse(base);
    expect(env.WORKER_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
    expect(queueConcurrency(env)).toEqual({
      system: 1,
      notifications: 1,
      credits: 1,
      images: 1,
      drugs: 1,
      rx: 2,
      evals: 1,
      payments: 1,
      seo: 1,
      content: 1,
    });
    expect(env.MAIL_DAILY_CAP).toBe(280);
    expect(env.SMTP_PORT).toBe(587);
    expect(env.MAIL_FROM).toContain("no-reply@wasfa.online");
  });

  it("reads concurrency per queue from the environment", () => {
    const env = workerEnvSchema.parse({
      ...base,
      WORKER_CONCURRENCY_SYSTEM: "4",
      WORKER_CONCURRENCY_NOTIFICATIONS: "2",
      WORKER_CONCURRENCY_CREDITS: "3",
      WORKER_CONCURRENCY_IMAGES: "2",
      WORKER_CONCURRENCY_DRUGS: "2",
      WORKER_CONCURRENCY_RX: "3",
    });
    expect(queueConcurrency(env)).toEqual({
      system: 4,
      notifications: 2,
      credits: 3,
      images: 2,
      drugs: 2,
      rx: 3,
      evals: 1,
      payments: 1,
      seo: 1,
      content: 1,
    });
  });

  it("rejects a missing or non-redis URL and out-of-range concurrency", () => {
    expect(workerEnvSchema.safeParse({ ENCRYPTION_KEY: base.ENCRYPTION_KEY }).success).toBe(false);
    expect(workerEnvSchema.safeParse({ ...base, REDIS_URL: "http://localhost" }).success).toBe(
      false,
    );
    expect(workerEnvSchema.safeParse({ ...base, WORKER_CONCURRENCY_SYSTEM: "0" }).success).toBe(
      false,
    );
  });

  it("requires a postgres DATABASE_URL", () => {
    expect(
      workerEnvSchema.safeParse({ REDIS_URL: base.REDIS_URL, ENCRYPTION_KEY: base.ENCRYPTION_KEY })
        .success,
    ).toBe(false);
    expect(workerEnvSchema.safeParse({ ...base, DATABASE_URL: "http://localhost" }).success).toBe(
      false,
    );
  });

  it("requires a 32-byte encryption key", () => {
    expect(workerEnvSchema.safeParse({ REDIS_URL: base.REDIS_URL }).success).toBe(false);
    expect(workerEnvSchema.safeParse({ ...base, ENCRYPTION_KEY: "c2hvcnQ=" }).success).toBe(false);
  });

  it("never captures mail in production: SMTP settings are required there", () => {
    expect(workerEnvSchema.safeParse({ ...base, NODE_ENV: "production" }).success).toBe(false);
    const ok = workerEnvSchema.safeParse({
      ...base,
      NODE_ENV: "production",
      SMTP_HOST: "smtp-relay.brevo.com",
      SMTP_USER: "login",
      SMTP_PASS: "key",
    });
    expect(ok.success).toBe(true);
  });

  it("needs SMTP_USER and SMTP_PASS together, and treats blanks as unset", () => {
    expect(workerEnvSchema.safeParse({ ...base, SMTP_USER: "login" }).success).toBe(false);
    const blank = workerEnvSchema.parse({ ...base, SMTP_HOST: "", SMTP_USER: "", SMTP_PASS: "" });
    expect(blank.SMTP_HOST).toBeUndefined();
  });

  it("takes the uploads storage keys all together or not at all", () => {
    const storage = {
      R2_UPLOADS_ENDPOINT: "http://127.0.0.1:9000",
      R2_UPLOADS_BUCKET: "wasfa-uploads",
      R2_UPLOADS_ACCESS_KEY_ID: "key",
      R2_UPLOADS_SECRET_ACCESS_KEY: "secret",
    };
    expect(workerEnvSchema.parse(base).R2_UPLOADS_REGION).toBe("auto");
    expect(workerEnvSchema.safeParse({ ...base, ...storage }).success).toBe(true);
    expect(
      workerEnvSchema.safeParse({ ...base, R2_UPLOADS_BUCKET: storage.R2_UPLOADS_BUCKET }).success,
    ).toBe(false);
  });
});
