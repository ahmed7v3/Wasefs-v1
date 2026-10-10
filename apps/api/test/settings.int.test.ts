import { auditLogs, createDb, errorEvents, seedDefaults, siteSettings } from "@wasfa/db";
import {
  PUBLIC_SETTING_KEYS,
  SETTING_KEYS,
  publicSettingsSchema,
  settingDefault,
} from "@wasfa/shared/settings";
import { and, count, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TURNSTILE_VERIFY_URL } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";
import { SETTINGS_CHANNEL, SettingsService } from "../src/settings/settings.service.js";

import { AuthHarness, PASSWORD, pwnedHandlers, testApiEnv } from "./support/auth-harness.js";
import { expectRateLimited } from "./support/identity-fixtures.js";
import { startInfra, type TestInfra } from "./support/infra.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

const network = setupServer(
  ...pwnedHandlers(),
  http.post(TURNSTILE_VERIFY_URL, () => HttpResponse.json({ success: true })),
);

let infra: TestInfra;
let app: NestFastifyApplication;
let second: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let redis: Redis;
let settings: SettingsService;
let secondSettings: SettingsService;
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  owner = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(owner.db);
  const env = testApiEnv(infra, { TURNSTILE_SECRET_KEY: "test-secret" });
  app = await createApp(env, { extraImports: [harness.mailerModule()], authMailer: false });
  // A second API instance on the same Postgres and Redis: what pub/sub invalidation is for.
  second = await createApp(env, { extraImports: [harness.mailerModule()], authMailer: false });
  settings = app.get(SettingsService);
  secondSettings = second.get(SettingsService);
  redis = new Redis(infra.redisUrl, { maxRetriesPerRequest: null });
}, 180_000);

afterAll(async () => {
  network.close();
  await redis?.quit();
  await second?.close();
  await app?.close();
  await owner?.close();
  await infra?.stop();
});

async function waitFor<T>(
  read: () => Promise<T | null | undefined | false>,
  ms = 5_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const settingAuditRows = (key: string) =>
  owner.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "setting.update"), eq(auditLogs.targetId, key)));

describe("GET /settings/public", () => {
  it("is public, cacheable, and serves exactly the public keys", async () => {
    const res = await harness.call("GET", "/settings/public");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");

    const body = res.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual([...PUBLIC_SETTING_KEYS].sort());
    expect(body).not.toHaveProperty("auth");
    expect(publicSettingsSchema.parse(body)).toMatchObject({
      branding: { nameEn: "Wasfa AI" },
      access: { signupOpen: true, maintenanceMode: false },
      free_tier: { monthlyAnalyses: 3 },
    });
  });

  it("is rate limited to 120 per minute per IP", async () => {
    await expectRateLimited(harness, { method: "GET", url: "/settings/public", max: 120 });
  });
});

describe("SettingsService", () => {
  it("seeds a row for every registered key", async () => {
    const rows = await owner.db.select({ key: siteSettings.key }).from(siteSettings);
    expect(rows.map((row) => row.key)).toEqual(expect.arrayContaining([...SETTING_KEYS]));
  });

  it("rejects an invalid value with field paths and stores nothing", async () => {
    await expect(
      settings.set(
        "branding",
        { nameEn: "", logoUrl: "http://insecure.test/logo.png" },
        { actorId: null },
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: expect.arrayContaining(["nameEn", "logoUrl"]) as string[] },
    });
    await expect(
      settings.set("currency", { default: "XXX", enabled: ["EGP"] }, { actorId: null }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["default"] } });
    expect(await settings.get("branding")).toEqual(settingDefault("branding"));
  });

  it("a write is visible at once, in the writing instance and the public endpoint", async () => {
    const written = await settings.set("free_tier", { monthlyAnalyses: 7 }, { actorId: null });
    expect(written).toEqual({ monthlyAnalyses: 7 });
    expect(await settings.get("free_tier")).toEqual({ monthlyAnalyses: 7 });
    const res = await harness.call("GET", "/settings/public");
    expect(res.json<{ free_tier: unknown }>().free_tier).toEqual({ monthlyAnalyses: 7 });
    await settings.set("free_tier", { monthlyAnalyses: 3 }, { actorId: null });
  });

  it("a write on one instance reaches the other through pub/sub, not after the 30 s TTL", async () => {
    // Both instances are subscribed (this connection counts as none: it only asks).
    await waitFor(async () => {
      const [, subscribers] = (await redis.pubsub("NUMSUB", SETTINGS_CHANNEL)) as [string, number];
      return subscribers >= 2;
    });
    // Warm the other instance's in-process cache with the old value first.
    expect((await secondSettings.get("locale")).showHijriDates).toBe(false);

    await settings.set(
      "locale",
      { defaultLocale: "ar", westernDigits: true, showHijriDates: true },
      { actorId: null },
    );
    await waitFor(async () => (await secondSettings.get("locale")).showHijriDates);

    await settings.set("locale", {}, { actorId: null });
    await waitFor(async () => !(await secondSettings.get("locale")).showHijriDates);
  });

  it("caches in Redis with an expiry (decision 11)", async () => {
    await settings.invalidate("socials");
    await settings.get("socials");
    const ttl = await redis.ttl("settings:v1:socials");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it("a corrupt stored value falls back to the default instead of failing", async () => {
    await owner.db
      .update(siteSettings)
      .set({ value: { nameEn: 123, nameAr: [] } })
      .where(eq(siteSettings.key, "branding"));
    await settings.invalidate("branding");
    try {
      expect(await settings.get("branding")).toEqual(settingDefault("branding"));
      expect((await harness.call("GET", "/settings/public")).statusCode).toBe(200);
    } finally {
      await settings.set("branding", {}, { actorId: null });
    }
  });

  it("a missing row yields the default", async () => {
    await owner.db.delete(siteSettings).where(eq(siteSettings.key, "socials"));
    await settings.invalidate("socials");
    try {
      expect(await settings.get("socials")).toEqual(settingDefault("socials"));
    } finally {
      await settings.set("socials", {}, { actorId: null });
    }
  });

  it("writes an audit row with before and after", async () => {
    const before = (await settingAuditRows("free_tier")).length;
    await settings.set("free_tier", { monthlyAnalyses: 9 }, { actorId: null });
    const rows = await settingAuditRows("free_tier");
    expect(rows).toHaveLength(before + 1);
    expect(rows).toContainEqual(
      expect.objectContaining({
        actorId: null,
        targetType: "setting",
        targetId: "free_tier",
        before: { monthlyAnalyses: 3 },
        after: { monthlyAnalyses: 9 },
      }),
    );
    await settings.set("free_tier", {}, { actorId: null });
  });
});

describe("maintenance mode", () => {
  const signUp = (email: string) =>
    harness.call("POST", "/auth/sign-up/email", {
      body: { name: "New", email, password: PASSWORD, callbackURL: "/login" },
      headers: { "x-turnstile-token": "pass" },
    });

  it("closes the API to ordinary users, keeps admins and the allow-listed routes working", async () => {
    const user = await harness.signedInUser();
    const admin = await harness.signedInUser();
    await harness.grantRole(admin.userId, "admin");

    const [errorsBefore] = await owner.db.select({ n: count() }).from(errorEvents);
    await settings.set("access", { signupOpen: true, maintenanceMode: true }, { actorId: null });
    try {
      const blocked = await harness.call("GET", "/orgs", { jar: user.jar });
      expect(blocked.statusCode).toBe(503);
      expect(blocked.json()).toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        details: { reason: "maintenance" },
      });
      expect(blocked.json<object>()).not.toHaveProperty("ref");

      // An anonymous caller still learns they need to sign in, not that the site is down.
      expect((await harness.call("GET", "/orgs")).statusCode).toBe(401);
      // A platform role is the admin bypass.
      expect((await harness.call("GET", "/orgs", { jar: admin.jar })).statusCode).toBe(200);

      expect((await harness.call("GET", "/health/live")).statusCode).toBe(200);
      const publicRes = await harness.call("GET", "/settings/public");
      expect(publicRes.statusCode).toBe(200);
      expect(publicRes.json<{ access: unknown }>().access).toEqual({
        signupOpen: true,
        maintenanceMode: true,
      });
      expect((await harness.call("GET", "/me", { jar: user.jar })).statusCode).toBe(200);
      const signIn = await harness.call("POST", "/auth/sign-in/email", {
        body: { email: user.email, password: PASSWORD },
      });
      expect(signIn.statusCode).toBe(200);

      const registered = await signUp(harness.nextEmail());
      expect(registered.statusCode).toBe(403);
      expect(registered.json()).toMatchObject({ details: { reason: "signup_closed" } });

      // Expected answers are not failures: nothing lands in error_events.
      const [errorsAfter] = await owner.db.select({ n: count() }).from(errorEvents);
      expect(errorsAfter?.n).toBe(errorsBefore?.n);
    } finally {
      await settings.set("access", {}, { actorId: null });
    }

    expect((await harness.call("GET", "/orgs", { jar: user.jar })).statusCode).toBe(200);
    expect((await signUp(harness.nextEmail())).statusCode).toBe(200);
  });
});
