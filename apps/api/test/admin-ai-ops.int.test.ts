import { randomUUID } from "node:crypto";

import {
  aiModels,
  aiProviders,
  aiUsage,
  auditLogs,
  onboardingProgress,
  type NewAiUsage,
} from "@wasfa/db";
import {
  aiOverviewSchema,
  aiUsagePageSchema,
  aiUsageTotalsSchema,
  playgroundResponseSchema,
  skillsResponseSchema,
  type AiOverview,
} from "@wasfa/shared/schemas/admin-ai";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin, type Person } from "./support/admin-context.js";
import { auditRows, expectRateLimited } from "./support/identity-fixtures.js";

import type { Permission } from "@wasfa/shared/permissions";
import type { LightMyRequestResponse } from "fastify";

/*
 * Task 2.4, second half: overview numbers, usage explorer (filters, keyset, totals, CSV), the
 * playground (real router with the fake provider, rate limit, audit without content, no keys) and the
 * skills setting with its enforcement in the chat.
 */

const ctx = new AdminTestContext();
let boss: Admin;
let echoId: string;
let jsonId: string;
let freeTierId: string;
const KEY = "sk-live-ops-abcdefghijklmnop-Z9x4";
let keyedModelId: string;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Body = Record<string, unknown>;
const call = (method: Method, url: string, who: { jar: Person["jar"] }, body?: Body) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function expectError(res: LightMyRequestResponse, status: number, code: string, details?: Body) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({ code, ...(details ? { details } : {}) });
}

async function insertModel(
  providerId: string,
  modelId: string,
  capabilities: ("json" | "vision")[],
): Promise<string> {
  const [row] = await ctx.owner.db
    .insert(aiModels)
    .values({
      providerId,
      modelId,
      displayName: modelId,
      capabilities,
      priceInputUsdMicrosPerM: 1_000_000,
      priceOutputUsdMicrosPerM: 2_000_000,
    })
    .returning({ id: aiModels.id });
  if (!row) throw new Error("model insert failed");
  return row.id;
}

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");

  const [fake] = await ctx.owner.db
    .insert(aiProviders)
    .values({ key: "ops-fake", kind: "fake", dataPolicy: "paid_no_training", enabled: true })
    .returning({ id: aiProviders.id });
  const [free] = await ctx.owner.db
    .insert(aiProviders)
    .values({ key: "ops-free", kind: "fake", dataPolicy: "free_tier", enabled: true })
    .returning({ id: aiProviders.id });
  if (!fake || !free) throw new Error("provider insert failed");
  echoId = await insertModel(fake.id, "fake-echo", ["json", "vision"]);
  jsonId = await insertModel(fake.id, "fake-json", ["json"]);
  freeTierId = await insertModel(free.id, "fake-echo", ["json", "vision"]);

  // A provider that really holds a key, to prove it never travels outward.
  const keyed = await call("POST", "/admin/ai/providers", boss, {
    key: "ops_keyed",
    kind: "fake",
    dataPolicy: "paid_no_training",
    enabled: true,
    apiKey: KEY,
  });
  expect(keyed.statusCode, keyed.body).toBe(201);
  const created = await call("POST", "/admin/ai/models", boss, {
    providerId: keyed.json<{ id: string }>().id,
    modelId: "fake-echo",
    displayName: "Keyed echo",
    capabilities: ["json"],
    priceInputUsdMicrosPerM: 1_000_000,
    priceOutputUsdMicrosPerM: 1_000_000,
  });
  expect(created.statusCode, created.body).toBe(201);
  keyedModelId = created.json<{ id: string }>().id;
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

interface Route {
  name: string;
  method: Method;
  url: string;
  needs: Permission;
  max: number;
  fresh: boolean;
  body?: Body;
}

const ROUTES: Route[] = [
  {
    name: "overview",
    method: "GET",
    url: "/admin/ai/overview",
    needs: "usage.read",
    max: 60,
    fresh: false,
  },
  {
    name: "usage list",
    method: "GET",
    url: "/admin/ai/usage",
    needs: "usage.read",
    max: 120,
    fresh: false,
  },
  {
    name: "usage totals",
    method: "GET",
    url: "/admin/ai/usage/totals",
    needs: "usage.read",
    max: 120,
    fresh: false,
  },
  {
    name: "usage export",
    method: "GET",
    url: "/admin/ai/usage/export.csv",
    needs: "usage.read",
    max: 10,
    fresh: false,
  },
  {
    name: "playground",
    method: "POST",
    url: "/admin/ai/playground",
    needs: "ai.write",
    max: 30,
    fresh: false,
    body: { task: "chat", input: "x", modelIds: [MISSING_ID] },
  },
  {
    name: "skills list",
    method: "GET",
    url: "/admin/ai/skills",
    needs: "ai.read",
    max: 120,
    fresh: false,
  },
  {
    name: "skill update",
    method: "PUT",
    url: "/admin/ai/skills/drug-info",
    needs: "ai.write",
    max: 30,
    fresh: true,
    body: { enabledFor: "all" },
  },
];

const send = (route: Route, who?: { jar: Person["jar"] }) =>
  ctx.harness.call(route.method, route.url, {
    ...(who ? { jar: who.jar } : {}),
    ...(route.body ? { body: route.body } : {}),
  });

describe("every new AI admin route", () => {
  const lacking = new Map<Permission, Admin>();
  let noSecondFactor: Person;
  let plain: Person;

  beforeAll(async () => {
    noSecondFactor = await ctx.adminWithoutTwoFactor("super_admin");
    plain = await ctx.harness.signedInUser();
    for (const permission of new Set(ROUTES.map((route) => route.needs))) {
      lacking.set(permission, await ctx.admin(await ctx.roleLacking(permission)));
    }
  }, 180_000);

  for (const route of ROUTES) {
    describe(`${route.method} ${route.name}`, () => {
      it("answers 401 without a session", async () => {
        expectError(await send(route), 401, "AUTH_REQUIRED");
      });

      it("answers 403 to a user without any role", async () => {
        expectError(await send(route, plain), 403, "FORBIDDEN");
      });

      it(`answers 403 to an admin holding everything except ${route.needs}`, async () => {
        const admin = lacking.get(route.needs);
        if (!admin) throw new Error("fixture missing");
        expectError(await send(route, admin), 403, "FORBIDDEN");
      });

      it("answers 403 two_factor_required without a second factor", async () => {
        expectError(await send(route, noSecondFactor), 403, "FORBIDDEN", {
          reason: "two_factor_required",
        });
      });

      it(route.fresh ? "asks for a fresh login" : "does not ask for a fresh login", async () => {
        const admin = await ctx.admin("super_admin");
        await ctx.makeSessionStale(admin.userId);
        const res = await send(route, admin);
        if (route.fresh) {
          expect(res.statusCode).toBe(401);
          expect(res.json()).toMatchObject({ details: { reason: "reauth" } });
        } else {
          expect(res.body).not.toContain("reauth");
        }
      });

      it(`limits it to ${String(route.max)} per minute`, async () => {
        await expectRateLimited(ctx.harness, {
          method: route.method,
          url: route.url,
          max: route.max,
          ...(route.body ? { body: route.body } : {}),
        });
      }, 60_000);
    });
  }
});

// --- Overview and usage explorer on seeded rows ---

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function usage(overrides: Partial<NewAiUsage>): NewAiUsage {
  return {
    task: "chat",
    modelKey: "fake-echo",
    ownerUserId: boss.userId,
    userId: boss.userId,
    outcome: "ok",
    costUsdMicros: 0,
    latencyMs: 100,
    ...overrides,
  };
}

describe("overview and usage explorer", () => {
  let orgId: string;

  beforeAll(async () => {
    const { insertOrg } = await import("./support/identity-fixtures.js");
    orgId = await insertOrg(ctx.owner.db, {
      createdBy: boss.userId,
      members: [{ userId: boss.userId, role: "org_admin" }],
    });
    await ctx.owner.db.delete(aiUsage);
    const now = Date.now();
    await ctx.owner.db.insert(aiUsage).values([
      // Analysis rx-1: read + verify, 4000 micros.
      usage({ task: "rx_extract", requestId: "rx-1", costUsdMicros: 3000, latencyMs: 1000 }),
      usage({ task: "rx_verify", requestId: "rx-1", costUsdMicros: 1000, latencyMs: 500 }),
      // Analysis rx-2: the first attempt failed, the second answered (a fallback), 3000 micros.
      usage({
        task: "rx_extract",
        requestId: "rx-2",
        outcome: "error",
        costUsdMicros: 500,
        latencyMs: 200,
        createdAt: new Date(now - 2000),
      }),
      usage({
        task: "rx_extract",
        requestId: "rx-2",
        costUsdMicros: 2500,
        latencyMs: 3000,
        createdAt: new Date(now - 1000),
      }),
      // A cache hit costs nothing and is not an analysis cost.
      usage({
        task: "rx_extract",
        requestId: "rx-3",
        outcome: "cache_hit",
        cacheHit: true,
        latencyMs: null,
      }),
      usage({
        task: "chat",
        requestId: "c-1",
        costUsdMicros: 100,
        latencyMs: 800,
        ownerUserId: null,
        ownerOrgId: orgId,
      }),
      // A system call (an eval): in the totals, not in the per-analysis figures.
      usage({
        task: "rx_extract",
        requestId: "e-1",
        modelKey: "fake-json",
        ownerUserId: null,
        userId: null,
        costUsdMicros: 777,
        latencyMs: 400,
      }),
      // 10 days ago (30-day window only) and 40 days ago (neither).
      usage({
        task: "chat",
        requestId: "old-10",
        costUsdMicros: 200,
        createdAt: new Date(now - 10 * DAY),
      }),
      usage({
        task: "chat",
        requestId: "old-40",
        costUsdMicros: 999_999,
        createdAt: new Date(now - 40 * DAY),
      }),
    ]);
  }, 60_000);

  const getOverview = async (days: number): Promise<AiOverview> => {
    const res = await call("GET", `/admin/ai/overview?days=${String(days)}`, boss);
    expect(res.statusCode, res.body).toBe(200);
    return aiOverviewSchema.parse(res.json());
  };

  it("computes the 7-day figures from the rows", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await ctx.redis.set(`ai:spend:${day}`, "1234");
    const data = await getOverview(7);
    await ctx.redis.del(`ai:spend:${day}`);

    expect(data.today).toMatchObject({ spendUsdMicros: 1234, source: "redis", alertPercent: 80 });
    expect(data.today.capUsdMicros).toBe(10_000_000);
    expect(data.totals).toMatchObject({
      calls: 7,
      costUsdMicros: 7877,
      errorRate: 0.1429,
      cacheHitRate: 0.1429,
      fallbackRate: 0.25,
      latencyP50Ms: 800,
      latencyP95Ms: 2600,
    });
    expect(data.perAnalysis).toEqual({ analyses: 2, avgUsdMicros: 3500, p95UsdMicros: 3950 });
    expect(data.byDay).toHaveLength(7);
    expect(data.byDay.reduce((sum, row) => sum + row.costUsdMicros, 0)).toBe(7877);
    expect(data.byTask.find((row) => row.task === "rx_extract")).toMatchObject({
      calls: 5,
      costUsdMicros: 6777,
    });
    expect(data.byModel[0]).toMatchObject({ modelKey: "fake-echo" });
  });

  it("widens to 30 days and rejects other ranges", async () => {
    const data = await getOverview(30);
    expect(data.totals.calls).toBe(8);
    expect(data.totals.costUsdMicros).toBe(8077);
    expect(data.byDay).toHaveLength(30);
    expectError(await call("GET", "/admin/ai/overview?days=90", boss), 400, "VALIDATION_FAILED");
  });

  const list = async (query: string) => {
    const res = await call("GET", `/admin/ai/usage${query}`, boss);
    expect(res.statusCode, res.body).toBe(200);
    return aiUsagePageSchema.parse(res.json());
  };

  it("filters by task, model, outcome, user, organization and dates", async () => {
    expect((await list("?task=rx_verify")).items).toHaveLength(1);
    expect((await list("?model=fake-json")).items).toHaveLength(1);
    expect((await list("?outcome=error")).items).toHaveLength(1);
    expect((await list("?outcome=cache_hit")).items).toHaveLength(1);
    expect((await list(`?orgId=${orgId}`)).items.map((row) => row.requestId)).toEqual(["c-1"]);
    // The acting user or the owner: the eval and org rows (no owner user) are not the boss.
    expect((await list(`?userId=${boss.userId}&limit=100`)).items).toHaveLength(8);
    const today = new Date().toISOString().slice(0, 10);
    expect((await list(`?from=${today}&to=${today}&limit=100`)).items).toHaveLength(7);
    const old = new Date(Date.now() - 40 * DAY).toISOString().slice(0, 10);
    expect((await list(`?to=${old}`)).items.map((row) => row.requestId)).toEqual(["old-40"]);
    expectError(
      await call("GET", `/admin/ai/usage?from=${today}&to=${old}`, boss),
      400,
      "VALIDATION_FAILED",
    );
    expectError(await call("GET", "/admin/ai/usage?cursor=@@", boss), 400, "VALIDATION_FAILED");
  });

  it("pages with a keyset cursor without repeating or skipping a row", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await list(`?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(9);
  });

  it("sums the totals over the same filters and never returns content fields", async () => {
    const res = await call("GET", "/admin/ai/usage/totals?task=rx_extract", boss);
    const totals = aiUsageTotalsSchema.parse(res.json());
    expect(totals).toMatchObject({ calls: 5, costUsdMicros: 6777, errors: 1, cacheHits: 1 });

    const page = await list("?limit=1");
    const keys = Object.keys(page.items[0] ?? {});
    expect(keys.filter((key) => /prompt|content|text|message|answer|body/i.test(key))).toEqual(
      [],
    );
  });

  it("exports a CSV that defuses formulas, and audits the export", async () => {
    await ctx.owner.db
      .insert(aiUsage)
      .values(
        usage({ modelKey: '=HYPERLINK("http://evil","x")', requestId: "@cmd", costUsdMicros: 1 }),
      );
    const res = await call("GET", "/admin/ai/usage/export.csv?task=chat&limit=100", boss);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("ai-usage.csv");
    const lines = res.body.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(
      "created_at,task,model,provider,owner_user_id,owner_org_id,user_id,input_tokens,cached_input_tokens,output_tokens,thinking_tokens,search_count,cost_usd_micros,credits_charged,latency_ms,outcome,cache_hit,request_id",
    );
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(res.body).toContain(",'@cmd");
    // No cell of the file starts with a formula character.
    for (const line of lines.slice(1)) {
      expect(line.split(",").every((cell) => !/^[=+@]/.test(cell))).toBe(true);
    }
    expect((await auditRows(ctx.owner.db, "ai.usage.export", boss.userId)).length).toBeGreaterThan(
      0,
    );
  });
});

// --- Playground ---

describe("playground", () => {
  const run = (who: { jar: Person["jar"] }, body: Body) =>
    call("POST", "/admin/ai/playground", who, body);

  it("runs up to three models side by side through the real router and records usage", async () => {
    const input = `unique-input-${randomUUID()}`;
    const res = await run(boss, { task: "chat", input, modelIds: [echoId, jsonId, keyedModelId] });
    expect(res.statusCode, res.body).toBe(200);
    const { runs } = playgroundResponseSchema.parse(res.json());
    expect(runs.map((item) => item.modelKey)).toEqual(["fake-echo", "fake-json", "fake-echo"]);
    expect(runs[0]).toMatchObject({ status: "ok", errorCode: null });
    expect(runs[0]?.output).toContain(input);
    expect(runs[0]?.usage?.inputTokens).toBeGreaterThan(0);
    expect(runs[0]?.costUsdMicros).toBeGreaterThan(0);
    expect(runs[1]?.output).toBe('{"ok":true}');
    expect(runs[0]?.validation).toEqual({ schema: null, ok: null, errors: [] });

    const rows = await ctx.owner.db
      .select()
      .from(aiUsage)
      .where(eq(aiUsage.userId, boss.userId))
      .orderBy(desc(aiUsage.createdAt))
      .limit(3);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.requestId?.startsWith("playground:"))).toBe(true);
  });

  it("validates a JSON task against the production schema and reports the errors", async () => {
    const res = await run(boss, { task: "rx_extract", input: "Panadol 500", modelIds: [jsonId] });
    expect(res.statusCode, res.body).toBe(200);
    const [item] = playgroundResponseSchema.parse(res.json()).runs;
    expect(item?.status).toBe("ok");
    expect(item?.validation.schema).toBe("rx_extract");
    expect(item?.validation.ok).toBe(false);
    expect(item?.validation.errors.length).toBeGreaterThan(0);
  });

  it("audits names and counts only: no input, no output, no key", async () => {
    const input = `secret-patient-text-${randomUUID()}`;
    const res = await run(boss, { task: "chat", input, modelIds: [keyedModelId] });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain(KEY);
    expect(res.body).not.toMatch(/apiKey|apiKeyEnc|keyHint/);

    const rows = await auditRows(ctx.owner.db, "ai.playground.run", boss.userId);
    const latest = JSON.stringify(rows[0]);
    expect(latest).toContain("fake-echo");
    expect(latest).not.toContain(input);
    const output = (res.json() as { runs: { output: string }[] }).runs[0]?.output ?? "";
    expect(output).toContain(input);
    expect(latest).not.toContain(output);
    // No audit row of any kind holds the provider key.
    expect(JSON.stringify(await ctx.owner.db.select().from(auditLogs))).not.toContain(KEY);
  });

  it("refuses bad input", async () => {
    expectError(
      await run(boss, { task: "chat", input: "", modelIds: [echoId] }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await run(boss, { task: "chat", input: "x", modelIds: [echoId, echoId] }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await run(boss, {
        task: "chat",
        input: "x",
        modelIds: [echoId, jsonId, keyedModelId, freeTierId],
      }),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await run(boss, { task: "chat", input: "x", modelIds: [MISSING_ID] }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await run(boss, { task: "chat", input: "x", fileIds: [MISSING_ID], modelIds: [echoId] }),
      404,
      "NOT_FOUND",
    );
  });

  it("is refused by the kill switch, the spend cap and the free-tier rule, like real traffic", async () => {
    const settings = await call("GET", "/admin/ai/settings", boss);
    const value = (settings.json() as { value: Body }).value;
    const put = (patch: Body) => call("PUT", "/admin/ai/settings", boss, { ...value, ...patch });

    await put({ killSwitch: { all: true, rx: false, chat: false, search: false } });
    const stopped = playgroundResponseSchema.parse(
      (await run(boss, { task: "chat", input: "x", modelIds: [echoId] })).json(),
    );
    await put({});
    expect(stopped.runs[0]).toMatchObject({ status: "refused", errorCode: "ai_paused" });

    const day = new Date().toISOString().slice(0, 10);
    await ctx.redis.set(`ai:spend:${day}`, "99999999999");
    const capped = playgroundResponseSchema.parse(
      (await run(boss, { task: "chat", input: "x", modelIds: [echoId] })).json(),
    );
    await ctx.redis.del(`ai:spend:${day}`);
    expect(capped.runs[0]).toMatchObject({ status: "refused", errorCode: "ai_paused" });

    const medical = playgroundResponseSchema.parse(
      (await run(boss, { task: "rx_extract", input: "x", modelIds: [freeTierId] })).json(),
    );
    expect(medical.runs[0]).toMatchObject({ status: "refused", errorCode: "no_model" });
  });

  it("allows 20 runs per hour per admin, then answers RATE_LIMITED", async () => {
    const admin = await ctx.admin("super_admin");
    for (let index = 0; index < 20; index += 1) {
      const res = await run(admin, { task: "chat", input: "x", modelIds: [echoId] });
      expect(res.statusCode, `run ${String(index + 1)}: ${res.body}`).toBe(200);
    }
    expectError(
      await run(admin, { task: "chat", input: "x", modelIds: [echoId] }),
      429,
      "RATE_LIMITED",
    );
    // Another admin has their own allowance.
    const other = await ctx.admin("super_admin");
    expect((await run(other, { task: "chat", input: "x", modelIds: [echoId] })).statusCode).toBe(
      200,
    );
  }, 120_000);
});

// --- Skills ---

describe("skills", () => {
  const getSkills = async () => {
    const res = await call("GET", "/admin/ai/skills", boss);
    expect(res.statusCode, res.body).toBe(200);
    return skillsResponseSchema.parse(res.json());
  };

  async function verifiedUser(): Promise<Person> {
    const user = await ctx.harness.signedInUser();
    await ctx.owner.db
      .insert(onboardingProgress)
      .values({ userId: user.userId, currentStep: "done", completedAt: new Date() });
    return user;
  }

  it("lists the generated registry with versions, all enabled by default", async () => {
    const data = await getSkills();
    const drug = data.items.find((item) => item.name === "drug-info");
    expect(drug?.version).toMatch(/^drug-info@[0-9a-f]{12}$/);
    expect(drug?.enabledFor).toBe("all");
    expect(data.items.find((item) => item.name === "prescription-analysis")?.chat).toBe(false);
    expect(data.plans.map((plan) => plan.key)).toEqual(expect.arrayContaining(["free", "pro"]));
  });

  it("stores the plans, audits the change, and refuses unknown skills, plans and gated tasks", async () => {
    const put = (name: string, enabledFor: unknown) =>
      call("PUT", `/admin/ai/skills/${name}`, boss, { enabledFor });
    const res = await put("lab-test-interpretation", ["pro"]);
    expect(res.statusCode, res.body).toBe(200);
    expect(
      skillsResponseSchema
        .parse(res.json())
        .items.find((item) => item.name === "lab-test-interpretation")?.enabledFor,
    ).toEqual(["pro"]);
    const audits = await auditRows(ctx.owner.db, "setting.update", boss.userId);
    expect(JSON.stringify(audits[0])).toContain("lab-test-interpretation");

    expectError(await put("nope", "all"), 404, "NOT_FOUND");
    expectError(await put("lab-test-interpretation", ["not_a_plan"]), 400, "VALIDATION_FAILED", {
      reason: "unknown_plan",
    });
    expectError(await put("prescription-analysis", ["pro"]), 400, "VALIDATION_FAILED", {
      reason: "not_a_chat_skill",
    });
    expect((await put("lab-test-interpretation", "all")).statusCode).toBe(200);
  });

  it("is not editable through the generic settings route", async () => {
    expectError(
      await call("PUT", "/admin/settings/skills", boss, { value: {} }),
      403,
      "FORBIDDEN",
      { reason: "use_admin_ai" },
    );
  });

  it("refuses a chat with a skill the plan lacks (PAYMENT_REQUIRED plan_feature), at start and at send", async () => {
    const user = await verifiedUser();
    const put = (enabledFor: unknown) =>
      call("PUT", "/admin/ai/skills/drug-info", boss, { enabledFor });

    const before = await call("POST", "/ai/chats", user, { skill: "drug-info" });
    expect(before.statusCode, before.body).toBe(201);
    const chatId = before.json<{ id: string }>().id;

    // The user is on the free plan; only pro has the skill now.
    expect((await put(["pro"])).statusCode).toBe(200);
    expectError(
      await call("POST", "/ai/chats", user, { skill: "drug-info" }),
      402,
      "PAYMENT_REQUIRED",
      {
        reason: "plan_feature",
      },
    );
    expectError(
      await call("POST", `/ai/chats/${chatId}/messages`, user, { content: "hi", mode: "balanced" }),
      402,
      "PAYMENT_REQUIRED",
      { reason: "plan_feature" },
    );
    // A chat without a skill, or with another skill, is not affected.
    expect((await call("POST", "/ai/chats", user, {})).statusCode).toBe(201);
    expect((await call("POST", "/ai/chats", user, { skill: "dose-calculator" })).statusCode).toBe(
      201,
    );

    expect((await put("all")).statusCode).toBe(200);
    expect((await call("POST", "/ai/chats", user, { skill: "drug-info" })).statusCode).toBe(201);
  });
});
