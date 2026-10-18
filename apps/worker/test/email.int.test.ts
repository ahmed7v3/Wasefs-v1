import { randomUUID } from "node:crypto";

import { createDb } from "@wasfa/db";
import { encryptSecret, decodeEncryptionKey } from "@wasfa/shared/crypto";
import { emailSecretContext, type EmailSendInput } from "@wasfa/shared/email";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";
import { MailCapGuard } from "../src/notifications/cap-guard.js";
import { createEmailRuntime, type EmailRuntime } from "../src/notifications/email.js";
import {
  PermanentMailError,
  readCapturedMail,
  type EmailTransport,
} from "../src/notifications/transport.js";
import { closeWorkers, startWorkers, type WorkerSet } from "../src/queues.js";

import { TEST_ENCRYPTION_KEY, testEnv } from "./support/env.js";
import { startRedis, type TestRedis } from "./support/redis.js";

const key = decodeEncryptionKey(TEST_ENCRYPTION_KEY);
const TOKEN = "tok_9f8e7d6c5b4a39281706";
const LINK = `https://api.wasfa.online/auth/verify-email?token=${TOKEN}`;

let redisInfra: TestRedis;
let connection: Redis;
let producer: Queue;
let set: WorkerSet | undefined;
// Email jobs never touch the database; the pool connects lazily, so this one never opens a socket.
const unusedDatabase = createDb({ url: "postgres://unused:unused@127.0.0.1:1/unused", max: 1 });
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function startWith(runtime: EmailRuntime): Promise<void> {
  if (set) {
    await closeWorkers(set.workers, 5_000);
    await Promise.all(set.queues.map((queue) => queue.close()));
  }
  set = startWorkers(
    connection,
    { system: 1, notifications: 2, credits: 1, images: 1, drugs: 1, rx: 1, evals: 1, payments: 1 },
    {
      redis: connection,
      db: unusedDatabase.db,
      logger,
      email: runtime,
    },
  );
}

const newAddress = () => `u-${randomUUID().slice(0, 8)}@example.com`;

function verifyJob(to: string): EmailSendInput {
  return {
    template: "verify_email",
    to,
    name: "منى",
    encryptedLink: encryptSecret(LINK, key, emailSecretContext("verify_email")),
  };
}

function inviteJob(to: string): EmailSendInput {
  return {
    template: "org_invite",
    to,
    orgName: "عيادة النور",
    inviterName: "سارة",
    encryptedLink: encryptSecret(LINK, key, emailSecretContext("org_invite")),
  };
}

async function enqueue(data: unknown, options: Record<string, unknown> = {}): Promise<string> {
  const jobId = `test-${randomUUID()}`;
  await producer.add("email.send", data, { jobId, ...options });
  return jobId;
}

async function capturedTo(to: string) {
  return waitFor(async () => (await readCapturedMail(connection)).find((mail) => mail.to === to));
}

async function finished(jobId: string): Promise<Job> {
  await waitFor(async () => {
    const job = await producer.getJob(jobId);
    return (await job?.isCompleted()) || (await job?.isFailed());
  });
  const job = await producer.getJob(jobId);
  if (job === undefined) throw new Error("job disappeared");
  return job;
}

beforeAll(async () => {
  redisInfra = await startRedis();
  connection = new Redis(redisInfra.url, { maxRetriesPerRequest: null });
  producer = new Queue("notifications", { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  await startWith(createEmailRuntime(testEnv(redisInfra.url), connection, logger));
});

afterAll(async () => {
  if (set) {
    await closeWorkers(set.workers, 5_000);
    await Promise.all(set.queues.map((queue) => queue.close()));
  }
  await producer.close();
  await connection.quit();
  await unusedDatabase.close();
  await redisInfra.stop();
});

describe("email.send", () => {
  it("delivers an enqueued verification mail to the capture transport with the RTL template", async () => {
    const to = newAddress();
    await enqueue(verifyJob(to));
    const mail = await capturedTo(to);
    expect(mail.subject).toBe("فعّل بريدك الإلكتروني في وصفة AI");
    expect(mail.from).toContain("no-reply@wasfa.online");
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain("مرحبًا منى،");
    // The worker decrypted the link: the recipient gets a working URL, the queue never held it.
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain(TOKEN);
  });

  it("rejects an invalid payload by schema, without retries and without echoing the value", async () => {
    const jobId = await enqueue({
      template: "verify_email",
      to: "not-an-email",
      encryptedLink: "x",
    });
    const job = await finished(jobId);
    expect(job.failedReason).toContain("Invalid payload for email.send");
    expect(job.failedReason).toContain("to");
    expect(job.failedReason).not.toContain("not-an-email");
    expect(job.attemptsMade).toBe(1);

    const unknown = await finished(
      await enqueue({ template: "marketing_blast", to: newAddress() }),
    );
    expect(unknown.failedReason).toContain("Invalid payload for email.send");
    expect(unknown.attemptsMade).toBe(1);

    const noLink = await finished(await enqueue({ template: "verify_email", to: newAddress() }));
    expect(noLink.failedReason).toContain("encryptedLink");
  });

  it("fails permanently when the link was encrypted for another template or another key", async () => {
    const to = newAddress();
    const wrongContext = await finished(
      await enqueue({
        ...verifyJob(to),
        encryptedLink: encryptSecret(LINK, key, emailSecretContext("reset_password")),
      }),
    );
    expect(wrongContext.failedReason).toBe("Email link could not be decrypted");
    expect(wrongContext.attemptsMade).toBe(1);
    expect((await readCapturedMail(connection)).some((mail) => mail.to === to)).toBe(false);
  });

  it("keeps the plaintext token and the address out of job data, failed history and logs", async () => {
    const to = newAddress();
    const jobId = await enqueue(verifyJob(to));
    await capturedTo(to);
    await finished(jobId);
    // A failing one too, so the failed-job history is covered as well.
    await finished(await enqueue({ ...verifyJob(newAddress()), encryptedLink: "v1.bad.bad.bad" }));

    const dump: string[] = [];
    for (const redisKey of await connection.keys("bull:notifications:*")) {
      const type = await connection.type(redisKey);
      if (type === "string") dump.push((await connection.get(redisKey)) ?? "");
      else if (type === "hash") dump.push(JSON.stringify(await connection.hgetall(redisKey)));
      else if (type === "list") dump.push((await connection.lrange(redisKey, 0, -1)).join("\n"));
      else if (type === "zset") dump.push((await connection.zrange(redisKey, 0, -1)).join("\n"));
      else if (type === "set") dump.push((await connection.smembers(redisKey)).join("\n"));
    }
    const everything = dump.join("\n");
    expect(everything).toContain("encryptedLink");
    expect(everything).not.toContain(TOKEN);

    const logText = logs.join("");
    expect(logText).toContain("Email sent");
    expect(logText).not.toContain(TOKEN);
    expect(logText).not.toContain(to);
  });

  it("writes one log line per send with a hashed recipient", async () => {
    logs.length = 0;
    const to = newAddress();
    await enqueue(verifyJob(to));
    await capturedTo(to);
    const sent = logs.filter((line) => line.includes("Email sent"));
    expect(sent).toHaveLength(1);
    const entry = JSON.parse(sent[0] ?? "{}") as { recipient: string; template: string };
    expect(entry.template).toBe("verify_email");
    expect(entry.recipient).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("failure handling", () => {
  function failingTransport(error: Error): EmailTransport {
    return {
      kind: "smtp",
      send: () => Promise.reject(error),
      close: () => undefined,
    };
  }

  it("does not retry a permanent rejection and records a redacted reason", async () => {
    await connection.flushall();
    const base = createEmailRuntime(testEnv(redisInfra.url), connection, logger);
    await startWith({
      ...base,
      transport: failingTransport(new PermanentMailError(550, "SMTP rejected the message (550)")),
    });
    const to = newAddress();
    const job = await finished(await enqueue(verifyJob(to)));
    expect(job.failedReason).toBe("SMTP rejected the message (550)");
    expect(job.attemptsMade).toBe(1);
    expect(job.failedReason).not.toContain(to);
    // The reserved slot was given back.
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(await connection.get(`mail:count:${today}`)).toBe("0");
  });

  it("retries a transient failure with backoff", async () => {
    const base = createEmailRuntime(testEnv(redisInfra.url), connection, logger);
    await startWith({
      ...base,
      transport: failingTransport(new Error("SMTP delivery failed (ETIMEDOUT)")),
    });
    const job = await finished(
      await enqueue(verifyJob(newAddress()), {
        attempts: 2,
        backoff: { type: "fixed", delay: 50 },
      }),
    );
    expect(job.failedReason).toBe("SMTP delivery failed (ETIMEDOUT)");
    expect(job.attemptsMade).toBe(2);
  });
});

describe("daily cap", () => {
  it("lets the first 280 through, delays the 281st non-critical mail, and still sends critical mail", async () => {
    await connection.flushall();
    const guard = new MailCapGuard(connection, 280, logger);
    for (let i = 0; i < 280; i++) {
      expect((await guard.reserve(false)).allowed).toBe(true);
    }
    const over = await guard.reserve(false);
    expect(over.allowed).toBe(false);
    if (!over.allowed) {
      const midnight = Math.floor(Date.now() / 86_400_000 + 1) * 86_400_000;
      expect(over.retryAt).toBeGreaterThanOrEqual(midnight);
      expect(over.retryAt).toBeLessThan(midnight + 5 * 60_000);
    }
    expect((await guard.reserve(true)).allowed).toBe(true);
    // A refused reservation gave its slot back, so only the critical one pushed the counter over.
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(await connection.get(`mail:count:${today}`)).toBe("281");
  });

  it("defers an over-cap invite to the next day without using a retry, while a verification mail sends", async () => {
    await connection.flushall();
    const env = testEnv(redisInfra.url, { MAIL_DAILY_CAP: "2" });
    await startWith(createEmailRuntime(env, connection, logger));

    const first = newAddress();
    const second = newAddress();
    await enqueue(inviteJob(first));
    await capturedTo(first);
    await enqueue(inviteJob(second));
    await capturedTo(second);

    const third = newAddress();
    const deferredId = await enqueue(inviteJob(third));
    const deferred = await waitFor(async () => {
      const job = await producer.getJob(deferredId);
      return (await job?.isDelayed()) ? job : null;
    });
    expect(deferred.attemptsMade).toBe(0);
    expect(deferred.delay).toBeGreaterThan(0);
    expect((await readCapturedMail(connection)).some((mail) => mail.to === third)).toBe(false);

    const critical = newAddress();
    await enqueue(verifyJob(critical));
    expect((await capturedTo(critical)).to).toBe(critical);
  });

  it("raises one alert per day when 80 percent of the cap is used", async () => {
    await connection.flushall();
    logs.length = 0;
    const guard = new MailCapGuard(connection, 10, logger);
    for (let i = 0; i < 10; i++) await guard.reserve(false);
    const alerts = logs.filter((line) => line.includes("80 percent"));
    expect(alerts).toHaveLength(1);
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    expect(await connection.get(`mail:alert:${today}`)).toBe("8");
  });
});
