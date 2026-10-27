import { parseEnv } from "@wasfa/shared/env";
import {
  mediaEnvShape,
  refineMediaEnv,
  refineUploadsEnv,
  uploadsEnvShape,
} from "@wasfa/shared/storage";
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
    /** ... and on the `rx` queue (prescription analysis: provider calls and image crops; 2 at a time). */
    WORKER_CONCURRENCY_RX: concurrency.default(2),
    /** ... and on the `evals` queue (accuracy runs spend provider money; one run at a time, items inside it run 2 at a time). */
    WORKER_CONCURRENCY_EVALS: concurrency,
    /** ... and on the `payments` queue (reconciliation, order expiry, outbox; one at a time keeps them ordered). */
    WORKER_CONCURRENCY_PAYMENTS: concurrency,
    /** ... and on the `seo` queue (IndexNow pings: one small HTTP call per job). */
    WORKER_CONCURRENCY_SEO: concurrency,
    /** ... and on the `content` queue (scheduled publishing; one run at a time keeps the daily cap exact). */
    WORKER_CONCURRENCY_CONTENT: concurrency,
    /** ... and on the `documents` queue (Typst renders of the WhatsApp agent files; 2 at a time, each is capped at 20 s). */
    WORKER_CONCURRENCY_DOCUMENTS: concurrency.default(2),
    /** The `typst` binary the agent files are rendered with (on PATH in the image). */
    TYPST_BIN: z.string().min(1).max(300).default("typst"),
    /** Where the web app answers inside the network (`http://web:3000`); unset = no cache purge (dev). */
    WEB_INTERNAL_URL: optional(z.url()),
    /** Signs the cache purge call to the web (`/api/revalidate`); unset = no cache purge (dev). */
    REVALIDATE_SECRET: optional(z.string().min(32)),
    /** The web app origin (first entry of the api's `WEB_ORIGIN` list): links in receipts point there. */
    WEB_ORIGIN: z
      .string()
      .default("http://localhost:3000")
      .transform((value) => value.split(",")[0]?.trim() ?? "")
      .pipe(z.url()),
    /** The API's public base URL: the one-click unsubscribe target of lifecycle mail (RFC 8058). */
    API_PUBLIC_URL: z.url().default("http://localhost:4000"),
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
    ALERT_TELEGRAM_BOT_TOKEN: optional(z.string().min(1).max(512)),

    // Uploaded images (Task 2.5): the same bucket and keys as the api. All four keys or none.
    ...uploadsEnvShape,
    ...mediaEnvShape,
  })
  .superRefine((env, ctx) => {
    refineUploadsEnv(env, ctx);
    refineMediaEnv(env, ctx);
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
    rx: env.WORKER_CONCURRENCY_RX,
    evals: env.WORKER_CONCURRENCY_EVALS,
    payments: env.WORKER_CONCURRENCY_PAYMENTS,
    seo: env.WORKER_CONCURRENCY_SEO,
    content: env.WORKER_CONCURRENCY_CONTENT,
    documents: env.WORKER_CONCURRENCY_DOCUMENTS,
  };
}
