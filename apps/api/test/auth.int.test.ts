import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

import { Controller, Get, Global, Module, Req } from "@nestjs/common";
import { accounts, createDb, roles, seedDefaults, sessions, userRoles, users } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { and, eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AuthModule } from "../src/auth/auth.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { AUTH_MAILER, type AuthMailer } from "../src/auth/mailer.js";
import { TURNSTILE_VERIFY_URL } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";
import { apiEnvSchema, type ApiEnv } from "../src/config/env.js";
import { SettingsService } from "../src/settings/settings.service.js";

import { startInfra, type TestInfra } from "./support/infra.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest, LightMyRequestResponse } from "fastify";

const WEB = "https://wasfa.online";
const PASSWORD = "correct horse battery";
const COMPROMISED = "Password123456";
const COMPROMISED_SHA1 = createHash("sha1").update(COMPROMISED).digest("hex").toUpperCase();

interface Mail {
  kind: "verify" | "reset";
  to: string;
  url: string;
}

const mails: Mail[] = [];
const mailer: AuthMailer = {
  sendVerificationEmail: ({ to, url }) => {
    mails.push({ kind: "verify", to, url });
    return Promise.resolve();
  },
  sendPasswordResetEmail: ({ to, url }) => {
    mails.push({ kind: "reset", to, url });
    return Promise.resolve();
  },
};

@Global()
@Module({ providers: [{ provide: AUTH_MAILER, useValue: mailer }], exports: [AUTH_MAILER] })
class MailerTestModule {}

/** Stands in for `/me` (Task 1.7): resolves the cookie through the same service the guard will use. */
@Controller("__test")
class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get("me")
  async me(@Req() request: FastifyRequest) {
    const session = await this.auth.getSession(request.headers);
    if (!session) throw new AppError(ErrorCode.AUTH_REQUIRED);
    return session.user;
  }
}

@Module({ imports: [AuthModule], controllers: [MeController] })
class MeTestModule {}

// ---------------------------------------------------------------------------------------------
// Network doubles: Turnstile, Have I Been Pwned and Google. Nothing here talks to the internet.
// ---------------------------------------------------------------------------------------------
const turnstileCalls: { response: string; remoteip: string; secret: string }[] = [];

function idToken(profile: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part({ iss: "https://accounts.google.com", aud: "google-id", ...profile })}.sig`;
}

const network = setupServer(
  http.post(TURNSTILE_VERIFY_URL, async ({ request }) => {
    const form = await request.formData();
    const call = {
      response: String(form.get("response")),
      remoteip: String(form.get("remoteip")),
      secret: String(form.get("secret")),
    };
    turnstileCalls.push(call);
    return HttpResponse.json({ success: call.response === "pass" });
  }),
  http.get("https://api.pwnedpasswords.com/range/:prefix", ({ params }) => {
    const prefix = String(params["prefix"]);
    return HttpResponse.text(
      COMPROMISED_SHA1.startsWith(prefix)
        ? `${COMPROMISED_SHA1.slice(5)}:12345\r\n0000000000000000000000000000000000A:1`
        : "0000000000000000000000000000000000A:1",
    );
  }),
  http.post("https://oauth2.googleapis.com/token", async ({ request }) => {
    const form = await request.formData();
    const profile = JSON.parse(Buffer.from(String(form.get("code")), "base64url").toString());
    return HttpResponse.json({
      access_token: "google-access-token",
      refresh_token: "google-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      id_token: idToken(profile),
    });
  }),
);

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------
let infra: TestInfra;
let app: NestFastifyApplication;
let env: ApiEnv;
let handle: ReturnType<typeof createDb>;
let settings: SettingsService;

beforeAll(async () => {
  // Containers first: the Docker client talks HTTP, which msw would otherwise intercept.
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
    TURNSTILE_SECRET_KEY: "turnstile-test-secret",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    // Facebook has keys but ships as `coming_soon`: the registry must still keep it closed.
    FACEBOOK_CLIENT_ID: "facebook-id",
    FACEBOOK_CLIENT_SECRET: "facebook-secret",
    ARGON2_MEMORY_KIB: 8192,
    LOG_LEVEL: "silent",
  });
  handle = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(handle.db);
  app = await createApp(env, { extraImports: [MailerTestModule, MeTestModule], authMailer: false });
  settings = app.get(SettingsService);
});

afterEach(() => {
  mails.length = 0;
  turnstileCalls.length = 0;
});

afterAll(async () => {
  network.close();
  await app?.close();
  await handle?.close();
  await infra?.stop();
});

type Jar = Map<string, string>;

function absorb(jar: Jar, res: LightMyRequestResponse): void {
  for (const line of [res.headers["set-cookie"] ?? []].flat()) {
    const [pair = "", ...attributes] = line.split(/;\s*/);
    const [name = "", ...rest] = pair.split("=");
    const value = rest.join("=");
    const expired = attributes.some((a) => /^max-age=0$/i.test(a)) || value === "";
    if (expired) jar.delete(name);
    else jar.set(name, value);
  }
}

const cookieHeader = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/** A random peer address per call site keeps rate-limit buckets from colliding between tests. */
const randomIp = () => `10.${randomInt(1, 200)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;

interface CallOptions {
  body?: Record<string, unknown>;
  jar?: Jar;
  ip?: string;
  turnstile?: string;
}

async function call(method: "GET" | "POST", url: string, options: CallOptions = {}) {
  const jar = options.jar ?? new Map();
  const res = await app.inject({
    method,
    url,
    remoteAddress: options.ip ?? randomIp(),
    headers: {
      origin: WEB,
      ...(jar.size > 0 ? { cookie: cookieHeader(jar) } : {}),
      ...(options.turnstile ? { "x-turnstile-token": options.turnstile } : {}),
    },
    ...(method === "POST" ? { payload: options.body ?? {} } : {}),
  });
  absorb(jar, res);
  return res;
}

let counter = 0;
const nextEmail = () => `user${++counter}-${randomBytes(3).toString("hex")}@example.com`;

async function register(email = nextEmail(), ip = randomIp()) {
  const res = await call("POST", "/auth/sign-up/email", {
    body: { name: "Test User", email, password: PASSWORD, callbackURL: "/login?verified=1" },
    turnstile: "pass",
    ip,
  });
  return { email, res };
}

/** Registers, follows the captured verification link, and returns the verified address. */
async function registerVerified(email = nextEmail()) {
  await register(email);
  const mail = mails.find((m) => m.kind === "verify" && m.to === email);
  if (!mail) throw new Error("no verification mail captured");
  const link = new URL(mail.url);
  const res = await call("GET", `${link.pathname}${link.search}`);
  expect(res.statusCode).toBe(302);
  return email;
}

async function signIn(email: string, jar: Jar = new Map(), password = PASSWORD, ip = randomIp()) {
  const res = await call("POST", "/auth/sign-in/email", { body: { email, password }, jar, ip });
  return { res, jar };
}

const me = (jar: Jar) => call("GET", "/__test/me", { jar });

async function userByEmail(email: string) {
  const [row] = await handle.db.select().from(users).where(eq(users.email, email));
  if (!row) throw new Error(`no user ${email}`);
  return row;
}

function totp(secretBase32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------
describe("email + password", () => {
  it("register → verify (captured) → login → /me → logout", async () => {
    const email = nextEmail();
    const registered = await register(email);
    expect(registered.res.statusCode).toBe(200);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ kind: "verify", to: email });

    // Not verified yet: the right password is still refused, and says why.
    const early = await signIn(email);
    expect(early.res.statusCode).toBe(401);
    expect(early.res.json()).toMatchObject({
      code: "AUTH_REQUIRED",
      details: { reason: "email_not_verified" },
    });
    expect((await me(early.jar)).statusCode).toBe(401);

    // The link in the mail points at the API and sends the browser back to the web app.
    // The first mail is the sign-up one; the unverified sign-in above sent a second.
    const link = new URL(mails[0]?.url ?? "");
    expect(link.origin).toBe("https://api.wasfa.online");
    const verified = await call("GET", `${link.pathname}${link.search}`);
    expect(verified.statusCode).toBe(302);
    expect(verified.headers["location"]).toBe(`${WEB}/login?verified=1`);
    expect((await userByEmail(email)).emailVerified).toBe(true);

    const { res, jar } = await signIn(email);
    expect(res.statusCode).toBe(200);
    // The raw session token lives in the HttpOnly cookie only, never in a body script could read.
    expect(JSON.stringify(res.json())).not.toMatch(/token/i);
    expect(res.json()).toMatchObject({ user: { name: "Test User", emailVerified: true } });

    const profile = await me(jar);
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ email, emailVerified: true });
    expect((await userByEmail(email)).lastLoginAt).toBeInstanceOf(Date);

    const out = await call("POST", "/auth/sign-out", { jar });
    expect(out.statusCode).toBe(200);
    expect((await me(jar)).statusCode).toBe(401);
  });

  it("stores Argon2id hashes only", async () => {
    const email = await registerVerified();
    const user = await userByEmail(email);
    const [account] = await handle.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")));
    expect(account?.password).toMatch(/^\$argon2id\$v=19\$m=8192,t=2,p=1\$/);
  });

  it("sets a Secure, HttpOnly, SameSite=Lax session cookie on the shared domain", async () => {
    const email = await registerVerified();
    const { res } = await signIn(email);
    const cookie = [res.headers["set-cookie"] ?? []]
      .flat()
      .find((c) => c.startsWith("__Secure-wasfa.session="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Domain=\.?wasfa\.online/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie).toMatch(/;\s*Max-Age=\d+/i);
  });

  it("answers a repeated registration exactly like a first one (no account enumeration)", async () => {
    const email = nextEmail();
    const first = await register(email);
    const second = await register(email);
    expect(second.res.statusCode).toBe(first.res.statusCode);
    expect(Object.keys(second.res.json() as object).sort()).toEqual(
      Object.keys(first.res.json() as object).sort(),
    );
    expect(await handle.db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
  });

  it("answers a wrong password and an unknown account identically", async () => {
    const email = await registerVerified();
    const wrong = await signIn(email, new Map(), "not the password");
    const unknown = await signIn(nextEmail(), new Map(), "not the password");
    expect(wrong.res.statusCode).toBe(401);
    expect(unknown.res.statusCode).toBe(401);
    expect(wrong.res.json()).toEqual(unknown.res.json());
  });

  it("rejects short and breached passwords with the field to highlight", async () => {
    const short = await call("POST", "/auth/sign-up/email", {
      body: { name: "A", email: nextEmail(), password: "short" },
      turnstile: "pass",
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["password"] },
    });

    const breached = await call("POST", "/auth/sign-up/email", {
      body: { name: "A", email: nextEmail(), password: COMPROMISED },
      turnstile: "pass",
    });
    expect(breached.statusCode).toBe(400);
    expect(breached.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "password_compromised", fields: ["password"] },
    });
  });

  it("maps errors to our shape: Arabic by default, English on request, no Better Auth text", async () => {
    const { res } = await signIn(nextEmail(), new Map(), "whatever password");
    const body = res.json() as { code: string; message: string };
    expect(body.message).toMatch(/[؀-ۿ]/);
    expect(JSON.stringify(body)).not.toMatch(/better.?auth/i);
    const english = await app.inject({
      method: "POST",
      url: "/auth/sign-in/email",
      remoteAddress: randomIp(),
      headers: { origin: WEB, "accept-language": "en" },
      payload: { email: nextEmail(), password: "whatever password" },
    });
    expect((english.json() as { message: string }).message).toMatch(/sign in/i);
  });

  it("sends a reset mail, accepts a new password once, and signs other sessions out", async () => {
    const email = await registerVerified();
    const { jar: oldSession } = await signIn(email);

    const request = await call("POST", "/auth/request-password-reset", {
      body: { email, redirectTo: "/reset-password" },
      turnstile: "pass",
    });
    expect(request.statusCode).toBe(200);
    // Same answer for an address that has no account.
    const stranger = await call("POST", "/auth/request-password-reset", {
      body: { email: nextEmail() },
      turnstile: "pass",
    });
    expect(stranger.statusCode).toBe(200);
    expect(stranger.json()).toEqual(request.json());

    const mail = mails.find((m) => m.kind === "reset" && m.to === email);
    expect(mail).toBeDefined();
    const link = new URL(mail?.url ?? "");
    const landing = await call("GET", `${link.pathname}${link.search}`);
    expect(landing.statusCode).toBe(302);
    const token = new URL(String(landing.headers["location"])).searchParams.get("token") ?? "";
    expect(token).not.toBe("");
    expect(String(landing.headers["location"]).startsWith(`${WEB}/reset-password`)).toBe(true);

    const reset = await call("POST", "/auth/reset-password", {
      body: { newPassword: "a brand new passphrase", token },
    });
    expect(reset.statusCode).toBe(200);
    expect((await me(oldSession)).statusCode).toBe(401);
    expect((await signIn(email, new Map(), "a brand new passphrase")).res.statusCode).toBe(200);
    expect((await signIn(email)).res.statusCode).toBe(401);
    const again = await call("POST", "/auth/reset-password", {
      body: { newPassword: "yet another passphrase", token },
    });
    expect(again.statusCode).toBe(400);
  });

  it("blocks disposable and admin-listed email domains, and a closed sign-up", async () => {
    const setSetting = async (key: "auth" | "access", value: Record<string, unknown>) => {
      await settings.set(key, value, { actorId: null });
    };
    try {
      const disposable = await register(`someone@mailinator.com`);
      expect(disposable.res.statusCode).toBe(400);
      expect(disposable.res.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { reason: "email_domain_blocked", fields: ["email"] },
      });

      await setSetting("auth", { blockedEmailDomains: ["corp-blocked.test"] });
      const listed = await register("x@mail.corp-blocked.test");
      expect(listed.res.json()).toMatchObject({ details: { reason: "email_domain_blocked" } });

      await setSetting("access", { signupOpen: false, maintenanceMode: false });
      const closed = await register();
      expect(closed.res.statusCode).toBe(403);
      expect(closed.res.json()).toMatchObject({
        code: "FORBIDDEN",
        details: { reason: "signup_closed" },
      });
    } finally {
      await setSetting("access", { signupOpen: true, maintenanceMode: false });
      await setSetting("auth", { blockedEmailDomains: [] });
    }
    expect((await register()).res.statusCode).toBe(200);
  });
});

describe("abuse protection", () => {
  it("requires Turnstile on register, and rejects a failed or missing token", async () => {
    const body = { name: "T", email: nextEmail(), password: PASSWORD };
    const missing = await call("POST", "/auth/sign-up/email", { body });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ details: { reason: "turnstile_required" } });
    const failed = await call("POST", "/auth/sign-up/email", { body, turnstile: "bad" });
    expect(failed.json()).toMatchObject({ details: { reason: "turnstile_failed" } });
    expect(await handle.db.select().from(users).where(eq(users.email, body.email))).toHaveLength(0);
  });

  it("verifies Turnstile server-side with the real client IP and our secret", async () => {
    const ip = randomIp();
    await register(nextEmail(), ip);
    expect(turnstileCalls).toEqual([
      { response: "pass", remoteip: ip, secret: "turnstile-test-secret" },
    ]);
  });

  it("wrong password ×3 → Turnstile required → rate limited after 5 per identifier", async () => {
    const email = await registerVerified();
    const ip = randomIp();
    const attempt = (turnstile?: string) =>
      call("POST", "/auth/sign-in/email", {
        body: { email, password: "wrong password!" },
        ip,
        ...(turnstile ? { turnstile } : {}),
      });

    for (let i = 0; i < 3; i += 1) {
      expect((await attempt()).statusCode).toBe(401);
    }
    const challenged = await attempt();
    expect(challenged.statusCode).toBe(400);
    expect(challenged.json()).toMatchObject({ details: { reason: "turnstile_required" } });
    // The challenged attempt still counted: the fifth passes the limiter, the sixth is blocked.
    expect((await attempt("pass")).statusCode).toBe(401);
    const limited = await attempt("pass");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED" });
    expect(
      (limited.json() as { details: { retryAfterSeconds: number } }).details.retryAfterSeconds,
    ).toBeGreaterThan(0);
    // The correct password is blocked too while the window is open.
    expect(
      (await call("POST", "/auth/sign-in/email", { body: { email, password: PASSWORD }, ip }))
        .statusCode,
    ).toBe(429);
  });

  it("clears the failure count after a successful login", async () => {
    const email = await registerVerified();
    const ip = randomIp();
    for (let i = 0; i < 2; i += 1) await signIn(email, new Map(), "wrong password!", ip);
    expect((await signIn(email, new Map(), PASSWORD, ip)).res.statusCode).toBe(200);
    for (let i = 0; i < 2; i += 1) await signIn(email, new Map(), "wrong password!", ip);
    // 2 + 2 failures would have crossed 3 had the success not reset the counter.
    expect((await signIn(email, new Map(), "wrong password!", ip)).res.json()).not.toMatchObject({
      details: { reason: "turnstile_required" },
    });
  });

  it("limits registrations to 5 per hour per IP", async () => {
    const ip = randomIp();
    for (let i = 0; i < 5; i += 1) {
      expect((await register(nextEmail(), ip)).res.statusCode).toBe(200);
    }
    const sixth = await register(nextEmail(), ip);
    expect(sixth.res.statusCode).toBe(429);
    expect(sixth.res.json()).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("limits password-reset requests to 3 per hour per address", async () => {
    const email = nextEmail();
    const send = () =>
      call("POST", "/auth/request-password-reset", { body: { email }, turnstile: "pass" });
    for (let i = 0; i < 3; i += 1) expect((await send()).statusCode).toBe(200);
    expect((await send()).statusCode).toBe(429);
  });

  it("never lets a client choose the IP Better Auth records", async () => {
    const email = await registerVerified();
    const jar: Jar = new Map();
    const peer = randomIp();
    await app
      .inject({
        method: "POST",
        url: "/auth/sign-in/email",
        remoteAddress: peer,
        headers: { origin: WEB, "x-wasfa-client-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7" },
        payload: { email, password: PASSWORD },
      })
      .then((res) => absorb(jar, res));
    const user = await userByEmail(email);
    const [row] = await handle.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(row?.ipAddress).toBe(peer);
  });

  it("rate limits requests to unknown routes", async () => {
    const ip = randomIp();
    const codes = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      codes.add(
        (await app.inject({ method: "GET", url: `/nothing-${i}`, remoteAddress: ip })).statusCode,
      );
    }
    expect(codes.has(404)).toBe(true);
    expect(codes.has(429)).toBe(true);
  });
});

describe("what is reachable", () => {
  it("answers 404 for every Better Auth route that is not allowlisted", async () => {
    const attempts: [string, string][] = [
      ["POST", "/auth/phone-number/send-otp"],
      ["POST", "/auth/phone-number/verify"],
      ["POST", "/auth/update-user"],
      ["POST", "/auth/delete-user"],
      ["POST", "/auth/change-email"],
      ["GET", "/auth/list-sessions"],
      ["POST", "/auth/revoke-sessions"],
      ["GET", "/auth/get-session"],
      ["POST", "/auth/link-social"],
      ["GET", "/auth/ok"],
      ["POST", "/auth/two-factor/send-otp"],
      ["POST", "/auth/sign-in/anonymous"],
      ["POST", "/auth/admin/create-user"],
    ];
    for (const [method, url] of attempts) {
      const res = await call(method as "GET" | "POST", url, { body: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("strips unknown body keys, so internal options cannot be reached through a body", async () => {
    const email = nextEmail();
    const res = await call("POST", "/auth/sign-up/email", {
      body: {
        name: "Sneaky",
        email,
        password: PASSWORD,
        status: "active",
        twoFactorEnabled: true,
        emailVerified: true,
        phoneVerified: true,
        image: "https://evil.example/x.png",
      },
      turnstile: "pass",
    });
    expect(res.statusCode).toBe(200);
    const user = await userByEmail(email);
    expect(user).toMatchObject({
      emailVerified: false,
      twoFactorEnabled: false,
      phoneVerified: false,
      image: null,
    });
  });

  it("only sends the browser to our own web origin after an auth action", async () => {
    const base = { name: "R", password: PASSWORD };
    for (const callbackURL of [
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ]) {
      const res = await call("POST", "/auth/sign-up/email", {
        body: { ...base, email: nextEmail(), callbackURL },
        turnstile: "pass",
      });
      expect(res.statusCode, callbackURL).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    const email = await registerVerified();
    const link = new URL(
      mails.find((m) => m.to === email)?.url ?? "https://x.test/auth/verify-email",
    );
    const tampered = await call(
      "GET",
      `/auth/verify-email?token=${link.searchParams.get("token") ?? "x"}&callbackURL=${encodeURIComponent("https://evil.example/")}`,
    );
    expect(tampered.statusCode).toBe(400);
  });

  it("serves the provider registry publicly and cacheably", async () => {
    const res = await call("GET", "/auth/providers");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toMatch(/max-age=\d+/);
    expect(res.json()).toEqual([
      { id: "google", status: "enabled" },
      { id: "facebook", status: "coming_soon" },
    ]);
  });
});

describe("phone + password", () => {
  async function registerPhone(phoneNumber: string) {
    const jar: Jar = new Map();
    const res = await call("POST", "/auth/sign-up/phone-number", {
      body: { name: "Phone User", phoneNumber, password: PASSWORD },
      turnstile: "pass",
      jar,
    });
    return { res, jar };
  }

  const verifyPhone = async (phoneNumber: string) => {
    await handle.db
      .update(users)
      .set({ phoneVerified: true, phoneVerifiedAt: new Date() })
      .where(eq(users.phone, phoneNumber));
  };

  const randomPhone = () => `+2010${randomInt(10_000_000, 99_999_999)}`;

  it("registers with a placeholder email and a session, so the phone can be verified next", async () => {
    const phone = randomPhone();
    const { res, jar } = await registerPhone(phone);
    expect(res.statusCode).toBe(200);
    expect((await me(jar)).statusCode).toBe(200);
    const [user] = await handle.db.select().from(users).where(eq(users.phone, phone));
    expect(user).toMatchObject({
      phoneVerified: false,
      phoneVerifiedAt: null,
      emailVerified: false,
    });
    expect(user?.email).toMatch(/^p[0-9a-f]{24}@phone\.wasfa\.invalid$/);
    expect(mails).toHaveLength(0);
  });

  it("signs in by a verified phone and password", async () => {
    const phone = randomPhone();
    await registerPhone(phone);
    await verifyPhone(phone);
    const jar: Jar = new Map();
    const res = await call("POST", "/auth/sign-in/phone-number", {
      body: { phoneNumber: phone, password: PASSWORD },
      jar,
    });
    expect(res.statusCode).toBe(200);
    expect((await me(jar)).statusCode).toBe(200);
  });

  it("treats an unverified phone, a wrong password and an unknown phone the same", async () => {
    const unverified = randomPhone();
    await registerPhone(unverified);
    const verified = randomPhone();
    await registerPhone(verified);
    await verifyPhone(verified);

    const attempt = (phoneNumber: string, password: string) =>
      call("POST", "/auth/sign-in/phone-number", { body: { phoneNumber, password } });
    const results = [
      await attempt(unverified, PASSWORD), // right password, phone not verified
      await attempt(verified, "wrong password!"),
      await attempt(randomPhone(), PASSWORD),
    ];
    for (const res of results) expect(res.statusCode).toBe(401);
    expect(results[0]?.json()).toEqual(results[1]?.json());
    expect(results[1]?.json()).toEqual(results[2]?.json());
  });

  it("does not sign in the owner of an unverified claim when someone else verified the number", async () => {
    const phone = randomPhone();
    await registerPhone(phone); // attacker claims the number first, with their own password
    const victim = await registerPhone(phone);
    expect(victim.res.statusCode).toBe(200);
    // Only the victim's account becomes verified.
    const rows = await handle.db.select().from(users).where(eq(users.phone, phone));
    expect(rows).toHaveLength(2);
    const victimRow = rows.at(-1);
    await handle.db
      .update(users)
      .set({ phoneVerified: true, phoneVerifiedAt: new Date() })
      .where(eq(users.id, victimRow?.id ?? ""));
    const attackerSignIn = await call("POST", "/auth/sign-in/phone-number", {
      body: { phoneNumber: phone, password: "attacker password" },
    });
    expect(attackerSignIn.statusCode).toBe(401);
  });

  it("rejects a malformed phone number as a validation error", async () => {
    const res = await call("POST", "/auth/sign-up/phone-number", {
      body: { name: "X", phoneNumber: "01001234567", password: PASSWORD },
      turnstile: "pass",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ details: { fields: ["phoneNumber"] } });
  });
});

describe("Google", () => {
  const profile = (email: string, extra: Record<string, unknown> = {}) => ({
    sub: `sub-${randomBytes(4).toString("hex")}`,
    email,
    email_verified: true,
    name: "Google Person",
    ...extra,
  });

  async function googleSignIn(claims: Record<string, unknown>, jar: Jar = new Map()) {
    const start = await call("POST", "/auth/sign-in/social", {
      body: { provider: "google", callbackURL: "/dashboard" },
      jar,
    });
    expect(start.statusCode).toBe(200);
    const { url } = start.json() as { url: string };
    const state = new URL(url).searchParams.get("state") ?? "";
    expect(new URL(url).host).toBe("accounts.google.com");
    const code = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const callback = await call("GET", `/auth/callback/google?code=${code}&state=${state}`, {
      jar,
    });
    return { callback, jar };
  }

  it("signs a new user in through a mocked Google and creates a verified account", async () => {
    const email = nextEmail();
    const { callback, jar } = await googleSignIn(profile(email));
    expect(callback.statusCode).toBe(302);
    expect(callback.headers["location"]).toBe(`${WEB}/dashboard`);
    expect((await me(jar)).json()).toMatchObject({ email, emailVerified: true });
    const user = await userByEmail(email);
    const [account] = await handle.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "google")));
    // Provider tokens are encrypted at rest.
    expect(account?.accessToken).toBeTruthy();
    expect(account?.accessToken).not.toContain("google-access-token");
    expect(account?.refreshToken).not.toContain("google-refresh-token");
  });

  it("links Google to an existing verified account", async () => {
    const email = await registerVerified();
    const before = await userByEmail(email);
    const { callback, jar } = await googleSignIn(profile(email));
    expect(callback.statusCode).toBe(302);
    expect((await me(jar)).json()).toMatchObject({ id: before.id });
  });

  it("defeats pre-registration takeover: an unverified squatter account is never linked to Google", async () => {
    const email = nextEmail();
    await register(email); // the attacker registers the victim's address; it is never verified
    const { callback, jar } = await googleSignIn(profile(email));
    expect(callback.statusCode).toBe(302);
    expect(String(callback.headers["location"])).toMatch(/error=account_not_linked/);
    expect((await me(jar)).statusCode).toBe(401);
    // Nothing was linked and the squatter's credentials were not promoted to a verified identity.
    const user = await userByEmail(email);
    expect(user.emailVerified).toBe(false);
    const linked = await handle.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "google")));
    expect(linked).toHaveLength(0);
    expect((await signIn(email)).res.statusCode).toBe(401); // still needs the mailbox proof
  });

  it("refuses a social sign-in for a disposable address and when sign-up is closed", async () => {
    const { callback } = await googleSignIn(profile("burner@mailinator.com"));
    expect(callback.statusCode).toBe(302);
    expect(String(callback.headers["location"])).toMatch(/error=/);
    expect(
      await handle.db.select().from(users).where(eq(users.email, "burner@mailinator.com")),
    ).toHaveLength(0);
  });

  it("will not use Google for an account that has two-factor authentication", async () => {
    const email = await registerVerified();
    const user = await userByEmail(email);
    await handle.db.update(users).set({ twoFactorEnabled: true }).where(eq(users.id, user.id));
    const { callback, jar } = await googleSignIn(profile(email));
    expect(String(callback.headers["location"])).toMatch(/error=/);
    expect((await me(jar)).statusCode).toBe(401);
  });
});

describe("provider registry", () => {
  it("keeps Facebook closed while it is coming soon, and opens it when the setting flips", async () => {
    const jar: Jar = new Map();
    const closed = await call("POST", "/auth/sign-in/social", {
      body: { provider: "facebook" },
      jar,
    });
    expect(closed.statusCode).toBe(400);
    expect(closed.json()).toMatchObject({ details: { reason: "provider_unavailable" } });

    const callback = await call("GET", "/auth/callback/facebook?code=x&state=y", { jar });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers["location"]).toBe(`${WEB}/login?error=provider_unavailable`);
    expect(jar.size).toBe(0);

    await settings.set(
      "auth",
      { providers: { google: "enabled", facebook: "enabled" } },
      { actorId: null },
    );
    try {
      expect((await call("GET", "/auth/providers")).json()).toContainEqual({
        id: "facebook",
        status: "enabled",
      });
      const open = await call("POST", "/auth/sign-in/social", { body: { provider: "facebook" } });
      expect(open.statusCode).toBe(200);
      expect(new URL((open.json() as { url: string }).url).host).toMatch(/facebook\.com$/);
      // The callback is now handled by Better Auth (it rejects the made-up state), not by our gate.
      const live = await call("GET", "/auth/callback/facebook?code=x&state=y");
      expect(live.headers["location"]).not.toBe(`${WEB}/login?error=provider_unavailable`);
    } finally {
      await settings.set(
        "auth",
        { providers: { google: "enabled", facebook: "coming_soon" } },
        { actorId: null },
      );
    }
  });

  it("never reports a provider without keys as enabled", async () => {
    const keyless = apiEnvSchema.parse({
      NODE_ENV: "test",
      DATABASE_URL: infra.databaseUrl,
      REDIS_URL: infra.redisUrl,
      WEB_ORIGIN: WEB,
      ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      BETTER_AUTH_SECRET: randomBytes(32).toString("base64"),
    });
    const { providerStates } = await import("../src/auth/providers.js");
    const states = providerStates(keyless, {
      providers: { google: "enabled", facebook: "enabled" },
      blockedEmailDomains: [],
      phoneVerification: "whatsapp_inbound",
      whatsappLogin: true,
      whatsappAgentSignup: true,
    });
    expect(states).toEqual([
      { id: "google", status: "disabled" },
      { id: "facebook", status: "disabled" },
    ]);
  });
});

describe("sessions", () => {
  it("is revoked on suspension: the open session dies and a new sign-in is refused", async () => {
    const email = await registerVerified();
    const { jar } = await signIn(email);
    expect((await me(jar)).statusCode).toBe(200);

    await handle.db
      .update(users)
      .set({ status: "suspended", suspendedReason: "test" })
      .where(eq(users.email, email));
    expect((await me(jar)).statusCode).toBe(401);
    const again = await signIn(email);
    expect(again.res.statusCode).toBe(403);
    expect(again.res.json()).toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "account_suspended" },
    });
    const user = await userByEmail(email);
    expect(
      await handle.db.select().from(sessions).where(eq(sessions.userId, user.id)),
    ).toHaveLength(0);
  });

  it("gives ordinary users 30 days and admins 12 hours, absolute", async () => {
    const regular = await registerVerified();
    await signIn(regular);
    const regularUser = await userByEmail(regular);
    const [regularSession] = await handle.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, regularUser.id));
    const days = ((regularSession?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThanOrEqual(30);

    const admin = await registerVerified();
    const adminUser = await userByEmail(admin);
    const [role] = await handle.db.select().from(roles).where(eq(roles.key, "support"));
    await handle.db
      .insert(userRoles)
      .values({ userId: adminUser.id, roleKey: role?.key ?? "support" });
    const { jar } = await signIn(admin);
    const [adminSession] = await handle.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, adminUser.id));
    const hours = ((adminSession?.expiresAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);

    // Sliding refresh must not stretch it: an admin session older than 12 hours is dead.
    expect((await me(jar)).statusCode).toBe(200);
    await handle.db
      .update(sessions)
      .set({
        createdAt: new Date(Date.now() - 13 * 3_600_000),
        expiresAt: new Date(Date.now() + 29 * 86_400_000),
      })
      .where(eq(sessions.userId, adminUser.id));
    expect((await me(jar)).statusCode).toBe(401);
  });
});

describe("two-factor", () => {
  it("enrols a TOTP, then password sign-in needs the code", async () => {
    const email = await registerVerified();
    const { jar } = await signIn(email);

    const enable = await call("POST", "/auth/two-factor/enable", {
      body: { password: PASSWORD },
      jar,
    });
    expect(enable.statusCode).toBe(200);
    const { totpURI, backupCodes } = enable.json() as { totpURI: string; backupCodes: string[] };
    expect(backupCodes.length).toBeGreaterThan(0);
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";

    const confirm = await call("POST", "/auth/two-factor/verify-totp", {
      body: { code: totp(secret) },
      jar,
    });
    expect(confirm.statusCode).toBe(200);
    expect((await userByEmail(email)).twoFactorEnabled).toBe(true);
    await call("POST", "/auth/sign-out", { jar });

    // Password alone no longer yields a session.
    const second: Jar = new Map();
    const first = await call("POST", "/auth/sign-in/email", {
      body: { email, password: PASSWORD },
      jar: second,
    });
    expect(first.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await me(second)).statusCode).toBe(401);

    const wrong = await call("POST", "/auth/two-factor/verify-totp", {
      body: { code: "000000" },
      jar: second,
    });
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    const done = await call("POST", "/auth/two-factor/verify-totp", {
      body: { code: totp(secret) },
      jar: second,
    });
    expect(done.statusCode).toBe(200);
    expect((await me(second)).statusCode).toBe(200);
  });

  it("applies to phone sign-in as well (the endpoint name keeps the plugin hook attached)", async () => {
    const phone = `+2011${randomInt(10_000_000, 99_999_999)}`;
    const jar: Jar = new Map();
    await call("POST", "/auth/sign-up/phone-number", {
      body: { name: "P", phoneNumber: phone, password: PASSWORD },
      turnstile: "pass",
      jar,
    });
    await handle.db
      .update(users)
      .set({ phoneVerified: true, phoneVerifiedAt: new Date() })
      .where(eq(users.phone, phone));
    const enable = await call("POST", "/auth/two-factor/enable", {
      body: { password: PASSWORD },
      jar,
    });
    const secret =
      new URL((enable.json() as { totpURI: string }).totpURI).searchParams.get("secret") ?? "";
    await call("POST", "/auth/two-factor/verify-totp", { body: { code: totp(secret) }, jar });
    await call("POST", "/auth/sign-out", { jar });

    const next: Jar = new Map();
    const res = await call("POST", "/auth/sign-in/phone-number", {
      body: { phoneNumber: phone, password: PASSWORD },
      jar: next,
    });
    expect(res.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await me(next)).statusCode).toBe(401);
  });
});
