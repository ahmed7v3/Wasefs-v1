import { randomInt, randomUUID } from "node:crypto";

import { createDb, seedDefaults, users } from "@wasfa/db";
import {
  WA_HEARTBEAT_KEY,
  WA_INBOUND_STREAM,
  WA_REPLY_STREAM,
  type InboundMessage,
} from "@wasfa/shared/schemas/phone";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TURNSTILE_VERIFY_URL } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";
import { SettingsService } from "../src/settings/settings.service.js";

import { AuthHarness, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { startInfra, type TestInfra } from "./support/infra.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const OUR_NUMBER = "201555000111";

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
let redis: Redis;
let settings: SettingsService;
const harness = new AuthHarness(
  () => app,
  () => handle.db,
);

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  const env = testApiEnv(infra, {
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    WHATSAPP_NUMBER: `+${OUR_NUMBER}`,
  });
  handle = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(handle.db);
  app = await createApp(env, { extraImports: [harness.mailerModule()], authMailer: false });
  settings = app.get(SettingsService);
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
});

afterAll(async () => {
  network.close();
  await redis?.quit();
  await app?.close();
  await handle?.close();
  await infra?.stop();
});

beforeEach(async () => {
  // The bridge is up unless a test says otherwise.
  await bridgeIs("connected");
  await setPhoneVerification("whatsapp_inbound");
});

async function bridgeIs(state: "connected" | "logged_out" | "gone"): Promise<void> {
  if (state === "gone") await redis.del(WA_HEARTBEAT_KEY);
  else await redis.set(WA_HEARTBEAT_KEY, JSON.stringify({ at: Date.now(), state }), "EX", 120);
}

async function setPhoneVerification(mode: "whatsapp_inbound" | "disabled"): Promise<void> {
  const current = await settings.get("auth");
  await settings.set("auth", { ...current, phoneVerification: mode }, { actorId: null });
}

const newPhone = () => `+2010${randomInt(10_000_000, 99_999_999)}`;

async function start(jar: Jar, phoneNumber: string, token: string | null = "pass") {
  return harness.call("POST", "/phone/verify/start", {
    jar,
    body: { phoneNumber },
    headers: token ? { "x-turnstile-token": token } : {},
  });
}

const status = (jar: Jar) => harness.call("GET", "/phone/verify/status", { jar });

async function sendInbound(
  sender: string,
  code: string,
  overrides: Partial<InboundMessage> = {},
): Promise<InboundMessage> {
  const message: InboundMessage = {
    id: `WA${randomUUID().slice(0, 12)}`,
    phone: sender,
    code,
    receivedAt: Date.now(),
    jid: `${sender.slice(1)}@s.whatsapp.net`,
    ...overrides,
  };
  await redis.xadd(WA_INBOUND_STREAM, "*", "data", JSON.stringify(message));
  return message;
}

async function waitFor<T>(
  read: () => Promise<T | null | undefined | false>,
  ms = 10_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function replyFor(inboundId: string) {
  return waitFor(async () => {
    const entries = await redis.xrange(WA_REPLY_STREAM, "-", "+");
    for (const [, fields] of entries) {
      const parsed = JSON.parse(fields[1] ?? "{}") as { inboundId?: string; outcome?: string };
      if (parsed.inboundId === inboundId) return parsed;
    }
    return null;
  });
}

async function userRow(userId: string) {
  const [row] = await handle.db.select().from(users).where(eq(users.id, userId));
  if (!row) throw new Error("no user");
  return row;
}

describe("access", () => {
  it("requires a session", async () => {
    expect((await start(new Map(), newPhone())).statusCode).toBe(401);
    expect((await status(new Map())).statusCode).toBe(401);
  });

  it("rejects a malformed number before doing anything", async () => {
    const { jar } = await harness.signedInUser();
    const res = await start(jar, "01012345678");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("requires Turnstile on start", async () => {
    const { jar } = await harness.signedInUser();
    const missing = await start(jar, newPhone(), null);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ details: { reason: "turnstile_required" } });
    const wrong = await start(jar, newPhone(), "fail");
    expect(wrong.json()).toMatchObject({ details: { reason: "turnstile_failed" } });
  });
});

describe("the happy path", () => {
  it("start → send the code from that number → verified, and the bridge is asked to confirm", async () => {
    const { jar, userId } = await harness.signedInUser();
    const phone = newPhone();

    const started = await start(jar, phone);
    expect(started.statusCode).toBe(200);
    const body = started.json<{
      status: string;
      code: string;
      waLink: string;
      waNumber: string;
      expiresAt: string;
    }>();
    expect(body.status).toBe("pending");
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.waNumber).toBe(`+${OUR_NUMBER}`);
    const link = new URL(body.waLink);
    expect(`${link.origin}${link.pathname}`).toBe(`https://wa.me/${OUR_NUMBER}`);
    expect(link.searchParams.get("text")).toContain(body.code);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    expect((await status(jar)).json()).toMatchObject({
      status: "pending",
      phone,
      available: true,
      bridge: "connected",
    });
    expect((await userRow(userId)).phoneVerified).toBe(false);

    const inbound = await sendInbound(phone, body.code);
    await waitFor(async () => (await status(jar)).json<{ status: string }>().status === "verified");
    const row = await userRow(userId);
    expect(row).toMatchObject({ phone, phoneVerified: true });
    expect(row.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(await replyFor(inbound.id)).toMatchObject({ outcome: "verified", jid: inbound.jid });
  });

  it("starting again for the same verified number answers verified without a new code", async () => {
    const { jar } = await harness.signedInUser();
    const phone = newPhone();
    const first = (await start(jar, phone)).json<{ code: string }>();
    await sendInbound(phone, first.code);
    await waitFor(async () => (await status(jar)).json<{ status: string }>().status === "verified");
    expect((await start(jar, phone)).json()).toEqual({ status: "verified" });
  });
});

describe("what must not verify", () => {
  it("the right code from another number is ignored, and the real owner can still finish", async () => {
    const { jar, userId } = await harness.signedInUser();
    const phone = newPhone();
    const { code } = (await start(jar, phone)).json<{ code: string }>();

    const thief = newPhone();
    const stolen = await sendInbound(thief, code);
    expect(await replyFor(stolen.id)).toMatchObject({ outcome: "invalid" });
    expect((await status(jar)).json()).toMatchObject({ status: "pending", phone });
    expect((await userRow(userId)).phoneVerified).toBe(false);

    await sendInbound(phone, code);
    await waitFor(async () => (await status(jar)).json<{ status: string }>().status === "verified");
  });

  it("an expired code does not verify", async () => {
    const { jar, userId } = await harness.signedInUser();
    const phone = newPhone();
    const { code } = (await start(jar, phone)).json<{ code: string }>();
    // Age the challenge past its expiry while the lookup key still exists.
    const challenge = JSON.parse((await redis.get(`phone:ch:${userId}`)) ?? "{}") as {
      expiresAt: number;
    };
    await redis.set(
      `phone:ch:${userId}`,
      JSON.stringify({ ...challenge, phone, code, expiresAt: Date.now() - 60_000 }),
      "EX",
      60,
    );
    const late = await sendInbound(phone, code, { receivedAt: Date.now() });
    expect(await replyFor(late.id)).toMatchObject({ outcome: "invalid" });
    expect((await userRow(userId)).phoneVerified).toBe(false);
  });

  it("a code whose Redis lifetime ended does not verify", async () => {
    const { jar, userId } = await harness.signedInUser();
    const phone = newPhone();
    const { code } = (await start(jar, phone)).json<{ code: string }>();
    const keys = await redis.keys("phone:code:*");
    const mine = [];
    for (const key of keys) if ((await redis.get(key)) === userId) mine.push(key);
    expect(mine).toHaveLength(1);
    await redis.del(...mine);
    const gone = await sendInbound(phone, code);
    expect(await replyFor(gone.id)).toMatchObject({ outcome: "invalid" });
    expect((await userRow(userId)).phoneVerified).toBe(false);
  });

  it("a replayed code does not verify anything a second time", async () => {
    const { jar, userId } = await harness.signedInUser();
    const phone = newPhone();
    const { code } = (await start(jar, phone)).json<{ code: string }>();
    await sendInbound(phone, code);
    await waitFor(async () => (await status(jar)).json<{ status: string }>().status === "verified");
    const verifiedAt = (await userRow(userId)).phoneVerifiedAt;

    const replay = await sendInbound(phone, code);
    expect(await replyFor(replay.id)).toMatchObject({ outcome: "invalid" });
    expect((await userRow(userId)).phoneVerifiedAt).toEqual(verifiedAt);
  });

  it("a number already verified on another account is refused", async () => {
    const owner = await harness.signedInUser();
    const phone = newPhone();
    const first = (await start(owner.jar, phone)).json<{ code: string }>();
    await sendInbound(phone, first.code);
    await waitFor(
      async () => (await status(owner.jar)).json<{ status: string }>().status === "verified",
    );

    const other = await harness.signedInUser();
    const second = (await start(other.jar, phone)).json<{ code: string }>();
    const attempt = await sendInbound(phone, second.code);
    expect(await replyFor(attempt.id)).toMatchObject({ outcome: "invalid" });
    expect((await status(other.jar)).json()).toMatchObject({
      status: "failed",
      failureReason: "phone_in_use",
    });
    expect((await userRow(other.userId)).phoneVerified).toBe(false);
    expect((await userRow(owner.userId)).phone).toBe(phone);
  });

  it("two accounts claiming the same number get different codes", async () => {
    const a = await harness.signedInUser();
    const b = await harness.signedInUser();
    const phone = newPhone();
    const first = (await start(a.jar, phone)).json<{ code: string }>();
    const second = (await start(b.jar, phone)).json<{ code: string }>();
    expect(first.code).not.toBe(second.code);
    // Only the account whose code arrives is verified.
    await sendInbound(phone, second.code);
    await waitFor(
      async () => (await status(b.jar)).json<{ status: string }>().status === "verified",
    );
    expect((await userRow(a.userId)).phoneVerified).toBe(false);
  });

  it("drops a malformed stream entry without getting stuck", async () => {
    await redis.xadd(WA_INBOUND_STREAM, "*", "data", "{not json");
    await redis.xadd(WA_INBOUND_STREAM, "*", "data", JSON.stringify({ phone: "nope" }));
    const { jar } = await harness.signedInUser();
    const phone = newPhone();
    const { code } = (await start(jar, phone)).json<{ code: string }>();
    await sendInbound(phone, code);
    await waitFor(async () => (await status(jar)).json<{ status: string }>().status === "verified");
    const pending = await redis.xpending(WA_INBOUND_STREAM, "api");
    expect(pending[0]).toBe(0);
  });
});

describe("limits", () => {
  it("allows 3 starts an hour per user and then answers RATE_LIMITED", async () => {
    const { jar } = await harness.signedInUser();
    for (let i = 0; i < 3; i++) {
      expect((await start(jar, newPhone())).statusCode).toBe(200);
    }
    const fourth = await start(jar, newPhone());
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("limits a single phone number across accounts", async () => {
    const phone = newPhone();
    for (let i = 0; i < 3; i++) {
      const user = await harness.signedInUser();
      expect((await start(user.jar, phone)).statusCode).toBe(200);
    }
    const user = await harness.signedInUser();
    expect((await start(user.jar, phone)).statusCode).toBe(429);
  });

  it("limits a single IP across accounts", async () => {
    const ip = `172.16.${randomInt(1, 250)}.${randomInt(1, 250)}`;
    for (let i = 0; i < 3; i++) {
      const user = await harness.signedInUser();
      const res = await harness.call("POST", "/phone/verify/start", {
        jar: user.jar,
        ip,
        body: { phoneNumber: newPhone() },
        headers: { "x-turnstile-token": "pass" },
      });
      expect(res.statusCode).toBe(200);
    }
    const user = await harness.signedInUser();
    const res = await harness.call("POST", "/phone/verify/start", {
      jar: user.jar,
      ip,
      body: { phoneNumber: newPhone() },
      headers: { "x-turnstile-token": "pass" },
    });
    expect(res.statusCode).toBe(429);
  });
});

describe("kill switch and bridge health", () => {
  it("hides the feature when an admin turns it off, and refuses to start", async () => {
    const { jar } = await harness.signedInUser();
    await setPhoneVerification("disabled");
    expect((await status(jar)).json()).toMatchObject({
      available: false,
      unavailableReason: "disabled",
    });
    const res = await start(jar, newPhone());
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ details: { reason: "phone_verification_disabled" } });
  });

  it("reports the bridge as down when its heartbeat is missing or it is logged out", async () => {
    const { jar } = await harness.signedInUser();
    await bridgeIs("gone");
    expect((await status(jar)).json()).toMatchObject({
      available: false,
      unavailableReason: "bridge_down",
      bridge: "down",
    });
    expect((await start(jar, newPhone())).statusCode).toBe(502);

    await bridgeIs("logged_out");
    expect((await status(jar)).json()).toMatchObject({ available: false, bridge: "logged_out" });
  });

  it("keeps the rest of the app working while the bridge is down", async () => {
    await bridgeIs("gone");
    expect((await harness.call("GET", "/health/ready")).statusCode).toBe(200);
    const user = await harness.signedInUser();
    expect(user.userId).toBeTruthy();
  });
});
