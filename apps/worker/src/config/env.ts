import { parseEnv } from "@wasfa/shared/env";
import { refineUploadsEnv, uploadsEnvShape } from "@wasfa/shared/storage";
import { z } from "zod";

import type { QueueName } from "@wasfa/shared/queues";

const concurrency = z.coerce.number().int().min(1).max(64).default(1);

/** Blank values (`KEY=` in a compose file) count as "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

const encryptionKeySchema = z
  .string()
  .refine(
    (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32,
    "must be 32 bytes, base64-encoded",
  );

export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Account maintenance jobs (anonymization, purge). In production: the restricted `wasfa_api` role. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** Same key as the api: it encrypts the links in email jobs, the worker decrypts them. */
    ENCRYPTION_KEY: encryptionKeySchema,
    /** Jobs a single worker process runs in parallel on the `system` queue. */
    WORKER_CONCURRENCY_SYSTEM: concurrency,
    /** ... and on the `notifications` queue (email). */
    WORKER_CONCURRENCY_NOTIFICATIONS: concurrency,
    /** ... and on the `credits` queue (reservation sweeper, monthly grants). */
    WORKER_CONCURRENCY_CREDITS: concurrency,
    /** ... and on the `images` queue (sharp and PDF rasterizing are CPU and memory heavy: keep it low). */
    WORKER_CONCURRENCY_IMAGES: concurrency,
    /** ... and on the `drugs` queue (list imports; one at a time is plenty, they are DB-heavy). */
    WORKER_CONCURRENCY_DRUGS: concurrency,
    /** How long shutdown waits for active jobs before force-closing. */
    WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),

    // Outgoing mail. Brevo's SMTP relay is the default; another provider is an env change only.
    // Without SMTP_HOST the worker captures mail in Redis instead (development and tests only).
    SMTP_HOST: optional(z.string().min(1)),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_USER: optional(z.string().min(1)),
    SMTP_PASS: optional(z.string().min(1)),
    MAIL_FROM: z.string().min(3).max(300).default('"وصفة AI" <no-reply@wasfa.online>'),
    /** Brevo's free plan allows 300 a day; the margin absorbs retries and manual sends. */
    MAIL_DAILY_CAP: z.coerce.number().int().min(1).max(1_000_000).default(280),

    // Uploaded images (Task 2.5): the same bucket and keys as the api. All four keys or none.
    ...uploadsEnvShape,
  })
  .superRefine((env, ctx) => {
    refineUploadsEnv(env, ctx);
    if (env.NODE_ENV === "production") {
      for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "is required in production (mail is never captured there)",
          });
        }
      }
    }
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASS === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_PASS"],
        message: "SMTP_USER and SMTP_PASS must be set together",
      });
    }
  });

export type WorkerEnv = z.output<typeof workerEnvSchema>;

/** Validates `process.env` (or `source`) at boot; prints bad key names and exits on failure. */
export function loadEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}

/** A `Record` over `QueueName`, so adding a queue to the registry fails to compile until it is configured. */
export function queueConcurrency(env: WorkerEnv): Record<QueueName, number> {
  return {
    system: env.WORKER_CONCURRENCY_SYSTEM,
    notifications: env.WORKER_CONCURRENCY_NOTIFICATIONS,
    credits: env.WORKER_CONCURRENCY_CREDITS,
    drugs: env.WORKER_CONCURRENCY_DRUGS,
    images: env.WORKER_CONCURRENCY_IMAGES,
  };
}
