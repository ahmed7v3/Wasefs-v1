import { randomInt } from "node:crypto";

import { contactMessages, createDb } from "@wasfa/db";
import { ErrorCode } from "@wasfa/shared/errors";
import { desc, eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthRateLimiter } from "../src/auth/rate-limiter.js";
import { TURNSTILE_VERIFY_URL, TurnstileService } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";
import { ContactService } from "../src/contact/contact.service.js";

import { AuthHarness, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { startInfra, type TestInfra } from "./support/infra.js";

import type { ContactRepo } from "../src/contact/contact.repo.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { PinoLogger } from "nestjs-pino";

const network = setupServer(
  ...pwnedHandlers(),
  http.post(TURNSTILE_VERIFY_URL, async ({ request }) => {
    const form = await request.formData();
    return HttpResponse.json({ success: form.get("response") === "pass" });
  }),
);

let infra: TestInfra;
let app: NestFastifyApplication;
let handle: ReturnType<typeof createDb>;
const harness = new AuthHarness(
  () => app,
  () => handle.db,
);

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  const env = testApiEnv(infra, { TURNSTILE_SECRET_KEY: "turnstile-test-secret" });
  handle = createDb({ url: infra.databaseUrl, max: 2 });
  app = await createApp(env, { extraImports: [harness.mailerModule()], authMailer: false });
});

afterAll(async () => {
  network.close();
  await app?.close();
  await handle?.close();
  await infra?.stop();
});

const randomIp = () => `10.${randomInt(1, 200)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;

/** A unique message text, so each test finds its own row. */
let counter = 0;
const nextText = () => `Please call me back about my question number ${++counter}-${randomInt(1e6)}`;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Mona Visitor",
    email: "mona@example.com",
    topic: "support",
    message: nextText(),
    ...overrides,
  };
}

async function send(
  body: Record<string, unknown>,
  options: {
    token?: string | null;
    ip?: string;
    jar?: Jar;
    headers?: Record<string, string>;
  } = {},
) {
  const token = options.token === undefined ? "pass" : options.token;
  return harness.call("POST", "/contact", {
    body,
    ...(options.ip ? { ip: options.ip } : {}),
    ...(options.jar ? { jar: options.jar } : {}),
    headers: { ...(token ? { "x-turnstile-token": token } : {}), ...options.headers },
  });
}

async function rowFor(message: string) {
  const [row] = await handle.db
    .select()
    .from(contactMessages)
    .where(eq(contactMessages.message, message))
    .orderBy(desc(contactMessages.createdAt));
  return row;
}

describe("sending a message", () => {
  it("stores the message as sent, for a visitor without an account", async () => {
    const body = payload({ phone: "+201001234567" });
    const res = await send(body);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ received: true });

    expect(await rowFor(body.message)).toMatchObject({
      name: "Mona Visitor",
      email: "mona@example.com",
      phone: "+201001234567",
      topic: "support",
      message: body.message,
      status: "new",
      locale: "ar",
      userId: null,
    });
  });

  it("accepts a phone alone and stores the language of the request", async () => {
    const body = payload({ email: undefined, phone: "+201001234567" });
    const res = await send(body, { headers: { "accept-language": "en-US,en;q=0.9" } });
    expect(res.statusCode).toBe(201);
    expect(await rowFor(body.message)).toMatchObject({ email: null, locale: "en" });
  });

  it("trims the text and does not echo it back", async () => {
    const text = nextText();
    const res = await send(payload({ name: "  Mona  ", message: `  ${text}  ` }));
    expect(res.body).not.toContain(text);
    expect(await rowFor(text)).toMatchObject({ name: "Mona", message: text });
  });

  it("attaches the account of a signed-in sender", async () => {
    const { jar, userId } = await harness.signedInUser();
    const body = payload();
    expect((await send(body, { jar })).statusCode).toBe(201);
    expect((await rowFor(body.message))?.userId).toBe(userId);
  });

  it("does not fail for a broken session cookie", async () => {
    const body = payload();
    const res = await send(body, { jar: new Map([["better-auth.session_token", "garbage"]]) });
    expect(res.statusCode).toBe(201);
    expect((await rowFor(body.message))?.userId).toBeNull();
  });
});

describe("Turnstile", () => {
  it("is required", async () => {
    const body = payload();
    const res = await send(body, { token: null });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "turnstile_required" },
    });
    expect(await rowFor(body.message)).toBeUndefined();
  });

  it("must pass", async () => {
    const body = payload();
    const res = await send(body, { token: "fail" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ details: { reason: "turnstile_failed" } });
    expect(await rowFor(body.message)).toBeUndefined();
  });
});

describe("input", () => {
  async function fieldsRejected(body: Record<string, unknown>): Promise<string> {
    const res = await send(body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    return res.body;
  }

  it("needs an email or a phone", async () => {
    expect(await fieldsRejected(payload({ email: undefined }))).toContain("email");
  });

  it("rejects a message that is too short or too long", async () => {
    expect(await fieldsRejected(payload({ message: "too short" }))).toContain("message");
    expect(await fieldsRejected(payload({ message: "x".repeat(4001) }))).toContain("message");
  });

  it("rejects a phone that is not E.164, a bad email and an unknown topic", async () => {
    expect(await fieldsRejected(payload({ phone: "01001234567" }))).toContain("phone");
    expect(await fieldsRejected(payload({ email: "not-an-email" }))).toContain("email");
    expect(await fieldsRejected(payload({ topic: "spam" }))).toContain("topic");
  });

  it("rejects a name that is too short", async () => {
    expect(await fieldsRejected(payload({ name: "A" }))).toContain("name");
  });
});

describe("limits", () => {
  it("allows 5 messages an hour from one IP, then answers RATE_LIMITED", async () => {
    const ip = randomIp();
    for (let i = 0; i < 5; i++) {
      expect((await send(payload(), { ip })).statusCode).toBe(201);
    }
    const sixth = await send(payload(), { ip });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json()).toMatchObject({ code: "RATE_LIMITED" });
    // Another visitor is unaffected.
    expect((await send(payload(), { ip: randomIp() })).statusCode).toBe(201);
  });

  it("counts a refused attempt before asking Turnstile, so bots cannot spend its quota", async () => {
    const ip = randomIp();
    for (let i = 0; i < 5; i++) await send(payload(), { ip });
    const res = await send(payload(), { ip, token: "fail" });
    expect(res.statusCode).toBe(429);
  });
});

describe("limits fail closed", () => {
  const brokenRedis = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("redis is down");
      },
    },
  ) as never;

  it("refuses the message, and stores nothing, when Redis is unreachable", async () => {
    const stored: unknown[] = [];
    const repo = {
      insert: (row: unknown) => {
        stored.push(row);
        return Promise.resolve();
      },
    } as unknown as ContactRepo;
    const logger = { setContext: () => undefined, info: () => undefined } as unknown as PinoLogger;
    const turnstile = { enabled: false } as unknown as TurnstileService;
    const service = new ContactService(
      repo,
      new AuthRateLimiter(brokenRedis),
      turnstile,
      {} as never,
      logger,
    );

    await expect(
      service.submit(
        {
          name: "Mona Visitor",
          email: "mona@example.com",
          topic: "support",
          message: nextText(),
        },
        { ip: "10.0.0.1", turnstileToken: undefined, locale: "ar", headers: {} },
      ),
    ).rejects.toMatchObject({ code: ErrorCode.UPSTREAM_UNAVAILABLE });
    expect(stored).toHaveLength(0);
  });
});
