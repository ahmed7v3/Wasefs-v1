import { randomUUID } from "node:crypto";

import { auditLogs, createDb, featureFlags, seedDefaults } from "@wasfa/db";
import { flagsResponseSchema } from "@wasfa/shared/settings";
import { and, eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TURNSTILE_VERIFY_URL } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";
import { FLAGS_CHANNEL, FlagsService } from "../src/flags/flags.service.js";

import { AuthHarness, pwnedHandlers, testApiEnv, type Jar } from "./support/auth-harness.js";
import { expectRateLimited, insertOrg } from "./support/identity-fixtures.js";
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
let flags: FlagsService;
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
  second = await createApp(env, { extraImports: [harness.mailerModule()], authMailer: false });
  flags = app.get(FlagsService);
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

const mine = async (jar: Jar) => {
  const res = await harness.call("GET", "/flags", { jar });
  expect(res.statusCode).toBe(200);
  return flagsResponseSchema.parse(res.json()).flags;
};

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

describe("GET /flags", () => {
  it("requires a session", async () => {
    const res = await harness.call("GET", "/flags");
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("is empty while no flag exists", async () => {
    const { jar } = await harness.signedInUser();
    expect(await mine(jar)).toEqual({});
  });

  it("evaluates every rule type for the caller", async () => {
    const user = await harness.signedInUser();
    // Organizations are resolved (and cached) on the first authenticated request: create it first.
    const orgId = await insertOrg(owner.db, {
      createdBy: user.userId,
      members: [{ userId: user.userId, role: "org_member" }],
    });
    const ctx = { actorId: null };
    const on = { enabled: true };
    await flags.set("t.all", { ...on, rules: { type: "all" } }, ctx);
    await flags.set("t.default_rules", { ...on, rules: {} }, ctx);
    await flags.set("t.off", { enabled: false, rules: { type: "all" } }, ctx);
    await flags.set("t.user_in", { ...on, rules: { type: "user", userIds: [user.userId] } }, ctx);
    await flags.set("t.user_out", { ...on, rules: { type: "user", userIds: [randomUUID()] } }, ctx);
    await flags.set(
      "t.org_in",
      { ...on, rules: { type: "org", orgIds: [randomUUID(), orgId] } },
      ctx,
    );
    await flags.set("t.org_out", { ...on, rules: { type: "org", orgIds: [randomUUID()] } }, ctx);
    await flags.set("t.pct_100", { ...on, rules: { type: "percentage", percentage: 100 } }, ctx);
    await flags.set("t.pct_0", { ...on, rules: { type: "percentage", percentage: 0 } }, ctx);
    await flags.set("t.plan", { ...on, rules: { type: "plan", plans: ["pro"] } }, ctx);

    const result = await mine(user.jar);
    expect(result).toEqual({
      "t.all": true,
      "t.default_rules": true,
      "t.off": false,
      "t.user_in": true,
      "t.user_out": false,
      "t.org_in": true,
      "t.org_out": false,
      "t.pct_100": true,
      "t.pct_0": false,
      "t.plan": false,
    });

    // Another caller gets their own answers from the same cached rows.
    const other = await harness.signedInUser();
    const otherFlags = await mine(other.jar);
    expect(otherFlags).toMatchObject({ "t.all": true, "t.user_in": false, "t.org_in": false });
  });

  it("is cached in Redis with an expiry (decision 11)", async () => {
    const ttl = await redis.ttl("flags:v1:all");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it("a write is visible on the next request, and reaches another instance through pub/sub", async () => {
    const { jar, userId } = await harness.signedInUser();
    const other = second.get(FlagsService);
    await waitFor(async () => {
      const [, subscribers] = (await redis.pubsub("NUMSUB", FLAGS_CHANNEL)) as [string, number];
      return subscribers >= 2;
    });

    await flags.set("t.toggle", { enabled: false, rules: { type: "all" } }, { actorId: null });
    expect((await mine(jar))["t.toggle"]).toBe(false);
    expect((await other.evaluateFor({ id: userId, orgIds: [] }))["t.toggle"]).toBe(false);

    await flags.set("t.toggle", { enabled: true, rules: { type: "all" } }, { actorId: null });
    expect((await mine(jar))["t.toggle"]).toBe(true);
    await waitFor(
      async () => (await other.evaluateFor({ id: userId, orgIds: [] }))["t.toggle"] === true,
    );

    await flags.remove("t.toggle", { actorId: null });
    expect(await mine(jar)).not.toHaveProperty("t.toggle");
    await waitFor(
      async () => !("t.toggle" in (await other.evaluateFor({ id: userId, orgIds: [] }))),
    );
  });

  it("a flag with unreadable stored rules is off, and does not break the others", async () => {
    await owner.db
      .insert(featureFlags)
      .values({ key: "t.broken", enabled: true, rules: { type: "nope" } });
    const { jar } = await harness.signedInUser();
    // The cached list predates the raw insert; a write through the service refreshes it.
    await flags.set("t.refresh", { enabled: true, rules: { type: "all" } }, { actorId: null });
    expect(await mine(jar)).toMatchObject({ "t.broken": false, "t.refresh": true });
  });

  it("writes are validated and audited", async () => {
    const ctx = { actorId: null };
    await expect(
      flags.set("Bad Key", { enabled: true, rules: { type: "all" } }, ctx),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      flags.set(
        "t.invalid",
        { enabled: true, rules: { type: "percentage", percentage: 150 } },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(flags.remove("t.never_existed", ctx)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    await flags.set("t.audited", { enabled: true, rules: { type: "all" } }, ctx);
    await flags.remove("t.audited", ctx);
    const rows = await owner.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetType, "flag"), eq(auditLogs.targetId, "t.audited")));
    expect(rows.map((row) => row.action).sort()).toEqual(["flag.delete", "flag.update"]);
  });

  it("is rate limited to 60 per minute per IP", async () => {
    const { jar } = await harness.signedInUser();
    await expectRateLimited(harness, { method: "GET", url: "/flags", max: 60, jar });
  });
});
