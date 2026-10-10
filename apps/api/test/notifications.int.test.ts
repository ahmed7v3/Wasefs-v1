import { randomBytes, randomUUID } from "node:crypto";

import { createDb, seedDefaults } from "@wasfa/db";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { emailSecretContext, emailSendPayloadSchema } from "@wasfa/shared/email";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/bootstrap.js";
import { apiEnvSchema, type ApiEnv } from "../src/config/env.js";
import { EmailQueue } from "../src/notifications/email-queue.js";

import { startInfra, type TestInfra } from "./support/infra.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const WEB = "https://wasfa.online";

// Breached-password lookups are the only outbound call a sign-up makes here.
const network = setupServer(
  http.get("https://api.pwnedpasswords.com/range/:prefix", () =>
    HttpResponse.text("0000000000000000000000000000000000A:1"),
  ),
);

let infra: TestInfra;
let app: NestFastifyApplication;
let env: ApiEnv;
let handle: ReturnType<typeof createDb>;
let redis: Redis;
let queue: Queue;

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  env = apiEnvSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    WEB_ORIGIN: WEB,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    API_PUBLIC_URL: "https://api.wasfa.online",
    AUTH_COOKIE_DOMAIN: ".wasfa.online",
    ARGON2_MEMORY_KIB: 8192,
    LOG_LEVEL: "silent",
  });
  handle = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(handle.db);
  // The real `QueueMailer`: nothing in this file replaces `AUTH_MAILER`.
  app = await createApp(env);
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue("notifications", { connection: redis });
});

afterAll(async () => {
  network.close();
  await queue?.close();
  await redis?.quit();
  await app?.close();
  await handle?.close();
  await infra?.stop();
});

async function jobsFor(to: string) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const jobs = await queue.getJobs(["waiting", "active", "delayed", "completed"]);
    const found = jobs.filter((job) => (job.data as { to?: string }).to === to);
    if (found.length > 0) return found;
    if (Date.now() > deadline) throw new Error("no job was queued");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("verification mail through the queue", () => {
  it("queues a valid email.send job whose link is encrypted, not readable in Redis", async () => {
    const email = `new-${randomUUID().slice(0, 8)}@example.com`;
    const res = await app.inject({
      method: "POST",
      url: "/auth/sign-up/email",
      headers: { origin: WEB, "content-type": "application/json" },
      remoteAddress: "10.9.8.7",
      payload: { name: "منى", email, password: "correct horse battery" },
    });
    expect(res.statusCode).toBe(200);

    const [job] = await jobsFor(email);
    if (!job) throw new Error("unreachable");
    expect(job.name).toBe("email.send");
    expect(job.opts.attempts).toBe(5);

    // The producer validates with the same schema the worker uses.
    const payload = emailSendPayloadSchema.parse(job.data);
    expect(payload).toMatchObject({ template: "verify_email", locale: "ar", name: "منى" });
    if (payload.template !== "verify_email") throw new Error("unreachable");

    const raw = JSON.stringify(job.data);
    expect(raw).not.toContain("token=");
    expect(raw).not.toContain("/auth/verify-email");

    const key = decodeEncryptionKey(env.ENCRYPTION_KEY);
    const link = decryptSecret(payload.encryptedLink, key, emailSecretContext("verify_email"));
    expect(link).toMatch(/^https:\/\/api\.wasfa\.online\/auth\/verify-email\?token=/);
    // Bound to its template: replaying it as a reset link fails.
    expect(() =>
      decryptSecret(payload.encryptedLink, key, emailSecretContext("reset_password")),
    ).toThrow();
  });
});

describe("EmailQueue", () => {
  it("rejects a malformed payload before queueing it", async () => {
    const emails = app.get(EmailQueue);
    await expect(
      emails.sendWithLink("verify_email", { to: "not-an-email" }, "https://wasfa.online/x"),
    ).rejects.toThrow();
  });

  it("queues invites and suspension notices with the right template", async () => {
    const emails = app.get(EmailQueue);
    const invitee = `invitee-${randomUUID().slice(0, 8)}@example.com`;
    const suspended = `suspended-${randomUUID().slice(0, 8)}@example.com`;
    await emails.sendOrgInvite(
      { to: invitee, locale: "ar" },
      { link: "https://wasfa.online/invite/abc", orgName: "عيادة النور", inviterName: "سارة" },
    );
    await emails.sendAccountSuspended({ to: suspended, name: "علي" });

    const [invite] = await jobsFor(invitee);
    const [notice] = await jobsFor(suspended);
    expect(emailSendPayloadSchema.parse(invite?.data)).toMatchObject({
      template: "org_invite",
      orgName: "عيادة النور",
    });
    expect(JSON.stringify(invite?.data)).not.toContain("invite/abc");
    expect(emailSendPayloadSchema.parse(notice?.data)).toMatchObject({
      template: "account_suspended",
    });
  });
});
