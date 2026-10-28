import { randomUUID } from "node:crypto";

import { createDb, seedDefaults, sessions, users } from "@wasfa/db";
import { WA_HEARTBEAT_KEY, WA_REPLY_STREAM } from "@wasfa/shared/schemas/phone";
import { WA_LOGIN_COOKIE, WA_LOGIN_STREAM, WA_LOGIN_METHOD } from "@wasfa/shared/schemas/wa-login";
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
  await redis.set(
    WA_HEARTBEAT_KEY,
    JSON.stringify({ at: Date.now(), state: "connected" }),
    "EX",
    120,
  );
  const auth = await settings.get("auth");
  await settings.set("auth", { ...auth, whatsappLogin: true }, { actorId: null });
});

const newPhone = () => `+2010${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

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

async function startLogin(jar: Jar, turnstile = "pass") {
  return harness.call("POST", "/auth/whatsapp/start", {
    jar,
    body: {},
    headers: { "x-turnstile-token": turnstile },
  });
}

const poll = (jar: Jar, token: string) =>
  harness.call("GET", `/auth/whatsapp/status?token=${encodeURIComponent(token)}`, { jar });

async function claim(phone: string, displayToken: string, kind: "login" | "logout" = "login") {
  const id = `WA${randomUUID().slice(0, 12)}`;
  await redis.xadd(
    WA_LOGIN_STREAM,
    "*",
    "data",
    JSON.stringify({
      kind,
      id,
      phone,
      jid: `${phone.slice(1)}@s.whatsapp.net`,
      receivedAt: Date.now(),
      ...(kind === "login" ? { token: displayToken.replace("-", ""), pushName: "Mona" } : {}),
    }),
  );
  return id;
}

async function replyFor(inboundId: string) {
  return waitFor(async () => {
    for (const [, fields] of await redis.xrange(WA_REPLY_STREAM, "-", "+")) {
      const parsed = JSON.parse(fields[1] ?? "{}") as { inboundId?: string; outcome?: string };
      if (parsed.inboundId === inboundId) return parsed;
    }
    return null;
  });
}

describe("start", () => {
  it("requires Turnstile and sets a scoped httpOnly nonce cookie", async () => {
    expect((await startLogin(new Map(), "fail")).statusCode).toBe(400);
    const jar: Jar = new Map();
    const res = await startLogin(jar);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; waLink: string; expiresAt: string }>();
    expect(body.token).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(body.waLink).toContain(`https://wa.me/${OUR_NUMBER}?text=`);
    const cookie = [res.headers["set-cookie"] ?? []]
      .flat()
      .find((line) => line.startsWith(`${WA_LOGIN_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/auth\/whatsapp/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(jar.has(WA_LOGIN_COOKIE)).toBe(true);
  });

  it("is unavailable when the admin switches it off", async () => {
    const auth = await settings.get("auth");
    await settings.set("auth", { ...auth, whatsappLogin: false }, { actorId: null });
    expect((await startLogin(new Map())).statusCode).toBe(403);
  });
});

describe("start -> bridge claim -> status -> session", () => {
  it("signs a new person in once, in the browser that asked, and tags the session", async () => {
    const phone = newPhone();
    const jar: Jar = new Map();
    const { token } = (await startLogin(jar)).json<{ token: string }>();

    const inbound = await claim(phone, token);
    expect((await replyFor(inbound)).outcome).toBe("login_ok");

    // Another browser (no cookie) learns nothing and gets nothing.
    expect((await poll(new Map(), token)).json()).toEqual({ status: "pending" });

    const signedIn = await poll(jar, token);
    expect(signedIn.json()).toEqual({ status: "signed_in", isNew: true });
    const me = await harness.call("GET", "/me", { jar });
    expect(me.statusCode).toBe(200);

    const [user] = await handle.db.select().from(users).where(eq(users.phone, phone));
    expect(user).toMatchObject({ phoneVerified: true, emailVerified: false });
    expect(user?.email).toMatch(/@phone\.wasfa\.invalid$/);
    const rows = await handle.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user?.id ?? ""));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.loginMethod).toBe(WA_LOGIN_METHOD);

    // The result was consumed: polling again mints nothing.
    expect((await poll(jar, token)).json()).toEqual({ status: "pending" });
  });

  it("answers a replayed token with login_expired", async () => {
    const phone = newPhone();
    const jar: Jar = new Map();
    const { token } = (await startLogin(jar)).json<{ token: string }>();
    await claim(phone, token);
    const second = await claim(phone, token);
    expect((await replyFor(second)).outcome).toBe("login_expired");
  });

  it("refuses an account with two-factor and tells the browser why", async () => {
    const phone = newPhone();
    const [created] = await handle.db
      .insert(users)
      .values({
        name: "Protected",
        email: `${randomUUID()}@example.com`,
        phone,
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        twoFactorEnabled: true,
      })
      .returning({ id: users.id });
    expect(created).toBeDefined();
    const jar: Jar = new Map();
    const { token } = (await startLogin(jar)).json<{ token: string }>();
    expect((await replyFor(await claim(phone, token))).outcome).toBe("login_refused");
    expect((await poll(jar, token)).json()).toEqual({ status: "refused", reason: "two_factor" });
    expect(
      await handle.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, created?.id ?? "")),
    ).toHaveLength(0);
  });

  it("logout revokes the WhatsApp sessions and replies logout_ok", async () => {
    const phone = newPhone();
    const jar: Jar = new Map();
    const { token } = (await startLogin(jar)).json<{ token: string }>();
    await claim(phone, token);
    await waitFor(
      async () => (await poll(jar, token)).json<{ status: string }>().status === "signed_in",
    );
    const [user] = await handle.db.select().from(users).where(eq(users.phone, phone));

    const inbound = await claim(phone, "", "logout");
    expect((await replyFor(inbound)).outcome).toBe("logout_ok");
    expect(
      await handle.db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user?.id ?? "")),
    ).toHaveLength(0);
    expect((await harness.call("GET", "/me", { jar })).statusCode).toBe(401);
  });
});

describe("availability", () => {
  it("is public and follows the setting", async () => {
    expect((await harness.call("GET", "/auth/whatsapp/availability")).json()).toEqual({
      available: true,
    });
    const auth = await settings.get("auth");
    await settings.set("auth", { ...auth, whatsappLogin: false }, { actorId: null });
    expect((await harness.call("GET", "/auth/whatsapp/availability")).json()).toEqual({
      available: false,
    });
  });
});
