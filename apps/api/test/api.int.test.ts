import { randomBytes, randomInt } from "node:crypto";

import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import { createDb, errorEvents } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { ERROR_REF_PATTERN } from "@wasfa/shared/ids";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { createApp } from "../src/bootstrap.js";
import { createZodDto } from "../src/common/validation.js";
import { apiEnvSchema, type ApiEnv } from "../src/config/env.js";

import { startInfra, type TestInfra } from "./support/infra.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

class EchoDto extends createZodDto(z.object({ name: z.string().min(2), age: z.number().int() })) {}

@Controller("__test")
class TestController {
  @Get("ping")
  ping() {
    return { pong: true };
  }

  @Get("boom")
  boom(): never {
    throw new Error("db password leak: postgres://wasfa:hunter2@db/wasfa for ali@example.com");
  }

  @Get("forbidden")
  forbidden(): never {
    throw new AppError(ErrorCode.FORBIDDEN);
  }

  @Post("echo")
  echo(@Body() body: EchoDto) {
    return body;
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

const ALLOWED_ORIGIN = "https://wasfa.online";
// Requests whose TCP peer is this address are treated as coming through Caddy.
const PROXY_IP = "10.250.0.1";

/** Random peer per test so Redis buckets never collide across tests or runs. */
function randomIp(): string {
  return `10.${randomInt(1, 200)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

let infra: TestInfra;
let app: NestFastifyApplication;
let env: ApiEnv;

beforeAll(async () => {
  infra = await startInfra();
  env = apiEnvSchema.parse({
    NODE_ENV: "test",
    DATABASE_URL: infra.databaseUrl,
    REDIS_URL: infra.redisUrl,
    WEB_ORIGIN: `${ALLOWED_ORIGIN},http://localhost:3000`,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TRUST_PROXY: PROXY_IP,
    LOG_LEVEL: "silent",
  });
  app = await createApp(env, { extraImports: [TestModule] });
});

afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

describe("health", () => {
  it("live is always 200", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("ready is 200 with DB + Redis up and reveals nothing else", async () => {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("health routes are not rate limited", async () => {
    const remoteAddress = randomIp();
    for (let i = 0; i < env.RATE_LIMIT_MAX + 5; i += 1) {
      const res = await app.inject({ method: "GET", url: "/health/live", remoteAddress });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("errors", () => {
  it("unknown errors return INTERNAL + ref, store a redacted error_events row, never the stack", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/boom", remoteAddress: randomIp() });
    expect(res.statusCode).toBe(500);
    const body = res.json<{ code: string; ref: string; message: string }>();
    expect(body.code).toBe("INTERNAL");
    expect(body.ref).toMatch(ERROR_REF_PATTERN);
    expect(Object.keys(body).sort()).toEqual(["code", "message", "ref"]);
    expect(res.body).not.toMatch(/hunter2|stack|at |\.ts:/);

    const { db, close } = createDb({ url: infra.databaseUrl, max: 1 });
    try {
      const [row] = await db.select().from(errorEvents).where(eq(errorEvents.ref, body.ref));
      expect(row).toBeDefined();
      expect(row?.code).toBe("INTERNAL");
      expect(row?.route).toBe("/__test/boom");
      expect(row?.method).toBe("GET");
      expect(row?.requestId).toBe(res.headers["x-request-id"]);
      expect(row?.stack).toContain("boom");
      expect(`${row?.message} ${row?.stack}`).not.toMatch(/hunter2|ali@example\.com/);
    } finally {
      await close();
    }
  });

  it("AppError maps to its status and code with an Arabic message by default", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test/forbidden",
      remoteAddress: randomIp(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      code: "FORBIDDEN",
      message: "ليست لديك صلاحية للقيام بهذا الإجراء.",
    });
  });

  it("unknown routes return NOT_FOUND in English when asked", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/does-not-exist",
      headers: { "accept-language": "en-US,en;q=0.9" },
      remoteAddress: randomIp(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      code: "NOT_FOUND",
      message: expect.stringMatching(/could not find/),
    });
  });

  it("uses a valid cf-ray as the request id", async () => {
    const ray = "8f1c2a3b4d5e6f70-CAI";
    const res = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "cf-ray": ray },
    });
    expect(res.headers["x-request-id"]).toBe(ray);
    const spoofed = await app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "cf-ray": "x\nforged" },
    });
    expect(spoofed.headers["x-request-id"]).not.toContain("forged");
  });
});

describe("validation", () => {
  it("strips unknown keys", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: { name: "Ali", age: 30, isAdmin: true },
      remoteAddress: randomIp(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ name: "Ali", age: 30 });
  });

  it("returns VALIDATION_FAILED with field paths and no echoed values", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: { name: "x", age: "secret-value" },
      remoteAddress: randomIp(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["name", "age"] },
    });
    expect(res.body).not.toContain("secret-value");
  });

  it("rejects bodies over 1 MB", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "a".repeat(1_100_000), age: 1 }),
      remoteAddress: randomIp(),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rejects malformed JSON without leaking parser details", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/__test/echo",
      headers: { "content-type": "application/json" },
      payload: "{bad json",
      remoteAddress: randomIp(),
    });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json<object>()).sort()).toEqual(["code", "message"]);
  });
});

describe("rate limiting", () => {
  it(`the ${121}st request in a minute from one IP gets 429 RATE_LIMITED`, async () => {
    const remoteAddress = randomIp();
    for (let i = 0; i < env.RATE_LIMIT_MAX; i += 1) {
      const res = await app.inject({ method: "GET", url: "/__test/ping", remoteAddress });
      expect(res.statusCode).toBe(200);
    }
    const res = await app.inject({ method: "GET", url: "/__test/ping", remoteAddress });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("a spoofed CF-Connecting-IP from an untrusted peer does not reset the bucket", async () => {
    const remoteAddress = randomIp();
    for (let i = 0; i < env.RATE_LIMIT_MAX; i += 1) {
      await app.inject({
        method: "GET",
        url: "/__test/ping",
        remoteAddress,
        headers: { "cf-connecting-ip": randomIp() },
      });
    }
    const res = await app.inject({
      method: "GET",
      url: "/__test/ping",
      remoteAddress,
      headers: { "cf-connecting-ip": randomIp() },
    });
    expect(res.statusCode).toBe(429);
  });

  it("behind the trusted proxy, clients are keyed by CF-Connecting-IP", async () => {
    const client = randomIp();
    for (let i = 0; i < env.RATE_LIMIT_MAX; i += 1) {
      await app.inject({
        method: "GET",
        url: "/__test/ping",
        remoteAddress: PROXY_IP,
        headers: { "cf-connecting-ip": client },
      });
    }
    const limited = await app.inject({
      method: "GET",
      url: "/__test/ping",
      remoteAddress: PROXY_IP,
      headers: { "cf-connecting-ip": client },
    });
    expect(limited.statusCode).toBe(429);
    const otherClient = await app.inject({
      method: "GET",
      url: "/__test/ping",
      remoteAddress: PROXY_IP,
      headers: { "cf-connecting-ip": randomIp() },
    });
    expect(otherClient.statusCode).toBe(200);
  });
});

describe("security headers and CORS", () => {
  it("sets API-appropriate security headers", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none';frame-ancestors 'none'",
    );
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allow-listed origin gets credentialed CORS headers", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/__test/echo",
      headers: { origin: ALLOWED_ORIGIN, "access-control-request-method": "POST" },
      remoteAddress: randomIp(),
    });
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("non-allow-listed origins get no CORS headers", async () => {
    for (const origin of ["https://evil.example", "https://wasfa.online.evil.example", "null"]) {
      const res = await app.inject({
        method: "GET",
        url: "/health/live",
        headers: { origin },
      });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    }
  });
});

// Keep last: it takes Postgres down for the rest of the file.
describe("readiness when Postgres is down", () => {
  it("returns 503 with a minimal body", async () => {
    let target = app;
    let tempApp: NestFastifyApplication | undefined;
    if (infra.stopPostgres) {
      await infra.stopPostgres();
    } else {
      // External services: point a second app at a port nothing listens on.
      tempApp = await createApp({ ...env, DATABASE_URL: "postgres://x:y@127.0.0.1:1/none" });
      target = tempApp;
    }
    try {
      const res = await target.inject({ method: "GET", url: "/health/ready" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: "unavailable" });
      const live = await target.inject({ method: "GET", url: "/health/live" });
      expect(live.statusCode).toBe(200);
    } finally {
      await tempApp?.close();
    }
  });
});
