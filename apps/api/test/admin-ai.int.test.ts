import { randomUUID } from "node:crypto";

import { AiProviderError, type AIProviderAdapter, type DiscoveredModel } from "@wasfa/ai";
import { aiModels, aiProviders, auditLogs } from "@wasfa/db";
import { decryptSecret, maskSecret } from "@wasfa/shared/crypto";
import {
  aiSettingsResponseSchema,
  discoverResponseSchema,
  modelListResponseSchema,
  modelViewSchema,
  priceSyncApplyResultSchema,
  priceSyncPreviewSchema,
  providerListResponseSchema,
  providerTestResultSchema,
  providerViewSchema,
  routeListResponseSchema,
  routeViewSchema,
  type AiSettingsResponse,
  type ModelView,
  type ProviderView,
  type RouteView,
} from "@wasfa/shared/schemas/admin-ai";
import { planViewSchema } from "@wasfa/shared/schemas/plans";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AiGatewayFactory } from "../src/admin/ai/ai-gateway.factory.js";
import { encryptionKey } from "../src/config/env.js";

import { AdminTestContext, MISSING_ID, type Admin, type Person } from "./support/admin-context.js";
import { expectRateLimited } from "./support/identity-fixtures.js";

import type { Permission } from "@wasfa/shared/permissions";
import type { LightMyRequestResponse } from "fastify";

const ctx = new AdminTestContext();
let gateway: AiGatewayFactory;
let boss: Admin;
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  gateway = ctx.app.get(AiGatewayFactory);
  boss = await ctx.admin("super_admin");
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Body = Record<string, unknown> | readonly unknown[];
const call = (method: Method, url: string, who: { jar: Person["jar"] }, body?: Body) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function expectError(
  res: LightMyRequestResponse,
  status: number,
  code: string,
  details?: Record<string, unknown>,
) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({ code, ...(details ? { details } : {}) });
}

const uniq = () => `${String(++counter)}_${randomUUID().slice(0, 6).replaceAll("-", "")}`;
const providerKey = () => `t${uniq()}`;

/** Scripts what the provider answers, without a network. */
function stubAdapter(overrides: Partial<AIProviderAdapter> = {}): AIProviderAdapter {
  return {
    stream: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true as const, value: undefined }),
      }),
    }),
    listModels: () => Promise.resolve([]),
    testConnection: () => Promise.resolve({ ok: true, latencyMs: 1 }),
    ...overrides,
  };
}

const stubGateway = (adapter: AIProviderAdapter) =>
  vi.spyOn(gateway, "adapterFor").mockReturnValue(adapter);

async function createProvider(extra: Record<string, unknown> = {}): Promise<ProviderView> {
  const res = await call("POST", "/admin/ai/providers", boss, {
    key: providerKey(),
    kind: "fake",
    dataPolicy: "paid_no_training",
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return providerViewSchema.parse(res.json());
}

async function createModel(
  providerId: string,
  extra: Record<string, unknown> = {},
): Promise<ModelView> {
  const res = await call("POST", "/admin/ai/models", boss, {
    providerId,
    modelId: `m-${uniq()}`,
    displayName: "Test model",
    capabilities: ["vision", "json"],
    priceInputUsdMicrosPerM: 1_000_000,
    priceCachedInputUsdMicrosPerM: null,
    priceOutputUsdMicrosPerM: 2_000_000,
    priceSearchUsdMicros: null,
    creditMultiplierBp: 10_000,
    enabled: true,
    priceSource: "manual",
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return modelViewSchema.parse(res.json());
}

async function listModels(query = ""): Promise<ModelView[]> {
  const res = await call("GET", `/admin/ai/models${query}`, boss);
  expect(res.statusCode, res.body).toBe(200);
  return modelListResponseSchema.parse(res.json()).items;
}

async function getSettings(): Promise<AiSettingsResponse> {
  const res = await call("GET", "/admin/ai/settings", boss);
  expect(res.statusCode, res.body).toBe(200);
  return aiSettingsResponseSchema.parse(res.json());
}

async function putSettings(who: { jar: Person["jar"] }, patch: Record<string, unknown>) {
  const { value } = await getSettings();
  return call("PUT", "/admin/ai/settings", who, { ...value, ...patch });
}

/** Runs `fn` while the API believes it is in production (the env object is shared by reference). */
async function inProduction<T>(fn: () => Promise<T>): Promise<T> {
  const before = ctx.env.NODE_ENV;
  ctx.env.NODE_ENV = "production";
  try {
    return await fn();
  } finally {
    ctx.env.NODE_ENV = before;
  }
}

const SETTINGS = {
  dailyCapUsdMicros: 10_000_000,
  alertPercent: 80,
  killSwitch: { all: false, rx: false, chat: false, search: false },
  creditValueUsdMicros: 10_000,
  allowPreviewModels: false,
};

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
    name: "providers list",
    method: "GET",
    url: "/admin/ai/providers",
    needs: "ai.read",
    max: 120,
    fresh: false,
  },
  {
    name: "provider create",
    method: "POST",
    url: "/admin/ai/providers",
    needs: "ai.write",
    max: 30,
    fresh: true,
    body: { key: "matrix_provider", kind: "fake", dataPolicy: "zdr" },
  },
  {
    name: "provider update",
    method: "PATCH",
    url: `/admin/ai/providers/${MISSING_ID}`,
    needs: "ai.write",
    max: 30,
    fresh: true,
    body: { priority: 1 },
  },
  {
    name: "provider delete",
    method: "DELETE",
    url: `/admin/ai/providers/${MISSING_ID}`,
    needs: "ai.write",
    max: 30,
    fresh: true,
  },
  {
    name: "provider test",
    method: "POST",
    url: `/admin/ai/providers/${MISSING_ID}/test`,
    needs: "ai.write",
    max: 10,
    fresh: false,
  },
  {
    name: "provider discover",
    method: "GET",
    url: `/admin/ai/providers/${MISSING_ID}/discover`,
    needs: "ai.read",
    max: 20,
    fresh: false,
  },
  {
    name: "models list",
    method: "GET",
    url: "/admin/ai/models",
    needs: "ai.read",
    max: 120,
    fresh: false,
  },
  {
    name: "model create",
    method: "POST",
    url: "/admin/ai/models",
    needs: "ai.write",
    max: 30,
    fresh: true,
    body: {
      providerId: MISSING_ID,
      modelId: "matrix-model",
      displayName: "Matrix",
      priceInputUsdMicrosPerM: 1,
      priceOutputUsdMicrosPerM: 1,
    },
  },
  {
    name: "model update",
    method: "PATCH",
    url: `/admin/ai/models/${MISSING_ID}`,
    needs: "ai.write",
    max: 30,
    fresh: true,
    body: { enabled: true },
  },
  {
    name: "model delete",
    method: "DELETE",
    url: `/admin/ai/models/${MISSING_ID}`,
    needs: "ai.write",
    max: 30,
    fresh: true,
  },
  {
    name: "price sync preview",
    method: "POST",
    url: "/admin/ai/models/price-sync/preview",
    needs: "ai.write",
    max: 5,
    fresh: false,
  },
  {
    name: "price sync apply",
    method: "POST",
    url: "/admin/ai/models/price-sync/apply",
    needs: "ai.write",
    max: 30,
    fresh: true,
    body: { token: "a".repeat(32) },
  },
  {
    name: "routes list",
    method: "GET",
    url: "/admin/ai/routes",
    needs: "ai.read",
    max: 120,
    fresh: false,
  },
  {
    name: "route put",
    method: "PUT",
    url: "/admin/ai/routes",
    needs: "ai.write",
    max: 30,
    fresh: true,
    body: {
      task: "chat",
      planId: null,
      mode: "fast",
      models: [{ modelId: MISSING_ID, params: {} }],
    },
  },
  {
    name: "route delete",
    method: "DELETE",
    url: `/admin/ai/routes/${MISSING_ID}`,
    needs: "ai.write",
    max: 30,
    fresh: true,
  },
  {
    name: "settings get",
    method: "GET",
    url: "/admin/ai/settings",
    needs: "ai.read",
    max: 120,
    fresh: false,
  },
  {
    name: "settings put",
    method: "PUT",
    url: "/admin/ai/settings",
    needs: "ai.write",
    max: 20,
    fresh: true,
    body: SETTINGS,
  },
];

const send = (route: Route, who?: { jar: Person["jar"] }) =>
  ctx.harness.call(route.method, route.url, {
    ...(who ? { jar: who.jar } : {}),
    ...(route.body ? { body: route.body } : {}),
  });

describe("every AI admin route", () => {
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
          expect(res.json()).toMatchObject({
            code: "AUTH_REQUIRED",
            details: { reason: "reauth", maxAgeMinutes: 10 },
          });
        } else {
          expect(res.body).not.toContain("reauth");
        }
      });

      it(`limits it to ${String(route.max)} per minute`, async () => {
        await expectRateLimited(ctx.harness, {
          method: route.method,
          url: route.url,
          max: route.max,
          ...(route.body && !Array.isArray(route.body)
            ? { body: route.body as Record<string, unknown> }
            : {}),
        });
      }, 60_000);
    });
  }
});

describe("providers", () => {
  const KEY = "sk-live-abcdefghijklmnop-Z9x4";
  const KEY_2 = "sk-live-qrstuvwxyzabcdef-Q7w2";

  it("lists the seeded providers as disabled and keyless", async () => {
    const res = await call("GET", "/admin/ai/providers", boss);
    expect(res.statusCode, res.body).toBe(200);
    const items = providerListResponseSchema.parse(res.json()).items;
    const gemini = items.find((provider) => provider.key === "gemini");
    expect(gemini).toMatchObject({
      kind: "gemini",
      enabled: false,
      hasKey: false,
      keyHint: null,
      lastTestAt: null,
      dataPolicy: "paid_no_training",
    });
    expect(gemini?.modelCount).toBeGreaterThan(0);
    expect(res.body).not.toContain("apiKeyEnc");
  });

  it("creates a provider with a key and never shows the key anywhere", async () => {
    const key = providerKey();
    const res = await call("POST", "/admin/ai/providers", boss, {
      key,
      kind: "openai_compatible",
      baseUrl: "https://llm.example.com/v1",
      dataPolicy: "zdr",
      priority: 40,
      enabled: true,
      apiKey: KEY,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.body).not.toContain(KEY);
    const created = providerViewSchema.parse(res.json());
    expect(created).toMatchObject({
      key,
      kind: "openai_compatible",
      baseUrl: "https://llm.example.com/v1",
      enabled: true,
      priority: 40,
      dataPolicy: "zdr",
      hasKey: true,
      keyHint: maskSecret(KEY),
      modelCount: 0,
    });
    expect(created.keyHint?.endsWith("Z9x4")).toBe(true);

    // Stored encrypted, bound to this provider.
    const [row] = await ctx.owner.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, created.id));
    expect(row?.apiKeyEnc).not.toContain(KEY);
    expect(decryptSecret(row?.apiKeyEnc ?? "", encryptionKey(ctx.env), `ai_provider:${key}`)).toBe(
      KEY,
    );

    const audit = await ctx.auditRowsFor("ai.provider.create", created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(boss.userId);
    expect(audit[0]?.after).toMatchObject({
      key,
      kind: "openai_compatible",
      enabled: true,
      priority: 40,
      dataPolicy: "zdr",
      hasKey: true,
      keyHint: maskSecret(KEY),
    });

    const list = await call("GET", "/admin/ai/providers", boss);
    expect(list.body).not.toContain(KEY);
  });

  it("replaces and clears a key, and leaves no plaintext in any audit row", async () => {
    const provider = await createProvider({
      kind: "openai_compatible",
      baseUrl: "https://llm.example.com/v1",
      apiKey: KEY,
    });
    const replaced = await call("PATCH", `/admin/ai/providers/${provider.id}`, boss, {
      apiKey: KEY_2,
    });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.body).not.toContain(KEY_2);
    const view = providerViewSchema.parse(replaced.json());
    expect(view).toMatchObject({ hasKey: true, keyHint: maskSecret(KEY_2) });
    const [row] = await ctx.owner.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, provider.id));
    expect(
      decryptSecret(row?.apiKeyEnc ?? "", encryptionKey(ctx.env), `ai_provider:${provider.key}`),
    ).toBe(KEY_2);

    const cleared = await call("PATCH", `/admin/ai/providers/${provider.id}`, boss, {
      clearKey: true,
    });
    expect(providerViewSchema.parse(cleared.json())).toMatchObject({
      hasKey: false,
      keyHint: null,
    });
    const [after] = await ctx.owner.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, provider.id));
    expect(after?.apiKeyEnc).toBeNull();

    const audit = await ctx.auditRowsFor("ai.provider.update", provider.id);
    expect(audit).toHaveLength(2);
    const allAudit = JSON.stringify(await ctx.owner.db.select().from(auditLogs));
    expect(allAudit).not.toContain(KEY);
    expect(allAudit).not.toContain(KEY_2);
    expect(JSON.stringify(audit.map((entry) => [entry.before, entry.after]))).toContain(
      maskSecret(KEY_2),
    );
  });

  it("refuses a repeated key, bad input and a key that cannot be both set and cleared", async () => {
    const provider = await createProvider();
    expectError(
      await call("POST", "/admin/ai/providers", boss, {
        key: provider.key,
        kind: "fake",
        dataPolicy: "zdr",
      }),
      409,
      "CONFLICT",
      { reason: "key_taken" },
    );
    const bad: Record<string, unknown>[] = [
      { key: "Bad Key", kind: "fake", dataPolicy: "zdr" },
      { key: "x", kind: "fake", dataPolicy: "zdr" },
      { key: providerKey(), kind: "telepathy", dataPolicy: "zdr" },
      { key: providerKey(), kind: "fake", dataPolicy: "public" },
      { key: providerKey(), kind: "openai_compatible", dataPolicy: "zdr" },
      { key: providerKey(), kind: "fake", dataPolicy: "zdr", baseUrl: "javascript:alert(1)" },
      { key: providerKey(), kind: "fake", dataPolicy: "zdr", baseUrl: "https://u:p@host.example" },
      { key: providerKey(), kind: "fake", dataPolicy: "zdr", apiKey: "short" },
      { key: providerKey(), kind: "fake", dataPolicy: "zdr", priority: 1.5 },
    ];
    for (const body of bad) {
      expectError(await call("POST", "/admin/ai/providers", boss, body), 400, "VALIDATION_FAILED");
    }
    for (const body of [
      {},
      { key: "other" },
      { apiKey: KEY, clearKey: true },
      { clearKey: false },
    ]) {
      expectError(
        await call("PATCH", `/admin/ai/providers/${provider.id}`, boss, body),
        400,
        "VALIDATION_FAILED",
      );
    }
    expectError(
      await call("PATCH", `/admin/ai/providers/${MISSING_ID}`, boss, { priority: 1 }),
      404,
      "NOT_FOUND",
    );
  });

  it("does not let a non-fake provider be enabled without a key", async () => {
    expectError(
      await call("POST", "/admin/ai/providers", boss, {
        key: providerKey(),
        kind: "gemini",
        dataPolicy: "paid_no_training",
        enabled: true,
      }),
      400,
      "VALIDATION_FAILED",
      { reason: "missing_key" },
    );
    const provider = await createProvider({ kind: "gemini" });
    expect(provider.enabled).toBe(false);
    expectError(
      await call("PATCH", `/admin/ai/providers/${provider.id}`, boss, { enabled: true }),
      400,
      "VALIDATION_FAILED",
      { reason: "missing_key" },
    );
    const enabled = await call("PATCH", `/admin/ai/providers/${provider.id}`, boss, {
      enabled: true,
      apiKey: KEY,
    });
    expect(providerViewSchema.parse(enabled.json())).toMatchObject({ enabled: true, hasKey: true });
    // And the key cannot be taken away from a provider that is on.
    expectError(
      await call("PATCH", `/admin/ai/providers/${provider.id}`, boss, { clearKey: true }),
      400,
      "VALIDATION_FAILED",
      { reason: "missing_key" },
    );
    // A fake provider needs no key.
    expect((await createProvider({ enabled: true })).enabled).toBe(true);
  });

  it("refuses the fake kind and plain-http URLs in production", async () => {
    await inProduction(async () => {
      expectError(
        await call("POST", "/admin/ai/providers", boss, {
          key: providerKey(),
          kind: "fake",
          dataPolicy: "zdr",
        }),
        403,
        "FORBIDDEN",
        { reason: "fake_in_production" },
      );
      expectError(
        await call("POST", "/admin/ai/providers", boss, {
          key: providerKey(),
          kind: "openai_compatible",
          dataPolicy: "zdr",
          baseUrl: "http://llm.example.com/v1",
        }),
        400,
        "VALIDATION_FAILED",
        { reason: "insecure_base_url" },
      );
    });
    // Outside production both are fine (local development and tests).
    const local = await createProvider({
      kind: "openai_compatible",
      baseUrl: "http://localhost:11434/v1",
    });
    const fake = await createProvider();
    await inProduction(async () => {
      expectError(
        await call("PATCH", `/admin/ai/providers/${fake.id}`, boss, { enabled: true }),
        403,
        "FORBIDDEN",
        { reason: "fake_in_production" },
      );
      expectError(
        await call("PATCH", `/admin/ai/providers/${local.id}`, boss, {
          baseUrl: "http://other.example.com/v1",
        }),
        400,
        "VALIDATION_FAILED",
        { reason: "insecure_base_url" },
      );
    });
  });

  it("deletes a provider without models and refuses one that has models", async () => {
    const empty = await createProvider();
    const gone = await call("DELETE", `/admin/ai/providers/${empty.id}`, boss);
    expect(gone.statusCode, gone.body).toBe(204);
    expect(await ctx.auditRowsFor("ai.provider.delete", empty.id)).toHaveLength(1);
    expectError(await call("DELETE", `/admin/ai/providers/${empty.id}`, boss), 404, "NOT_FOUND");

    const used = await createProvider();
    await createModel(used.id);
    expectError(await call("DELETE", `/admin/ai/providers/${used.id}`, boss), 409, "CONFLICT", {
      reason: "provider_in_use",
    });
  });

  it("tests a connection, also for a disabled provider, and records the result", async () => {
    const provider = await createProvider();
    expect(provider.enabled).toBe(false);
    const res = await call("POST", `/admin/ai/providers/${provider.id}/test`, boss);
    expect(res.statusCode, res.body).toBe(200);
    expect(providerTestResultSchema.parse(res.json())).toMatchObject({ ok: true, errorCode: null });

    const [row] = await ctx.owner.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, provider.id));
    expect(row).toMatchObject({ lastTestOk: true, lastTestError: null });
    expect(row?.lastTestAt).toBeInstanceOf(Date);

    const audit = await ctx.auditRowsFor("ai.provider.test", provider.id);
    expect(audit[0]?.after).toMatchObject({ ok: true, errorCode: null });
  });

  it("records the error code of a failing test, and never calls out without a key", async () => {
    const provider = await createProvider();
    const spy = stubGateway(
      stubAdapter({
        testConnection: () =>
          Promise.resolve({ ok: false, latencyMs: 12, errorCode: "rate_limited" }),
      }),
    );
    const failed = providerTestResultSchema.parse(
      (await call("POST", `/admin/ai/providers/${provider.id}/test`, boss)).json(),
    );
    expect(failed).toMatchObject({ ok: false, latencyMs: 12, errorCode: "rate_limited" });
    const [row] = await ctx.owner.db
      .select()
      .from(aiProviders)
      .where(eq(aiProviders.id, provider.id));
    expect(row).toMatchObject({ lastTestOk: false, lastTestError: "rate_limited" });

    spy.mockReturnValue(
      stubAdapter({
        testConnection: () => Promise.reject(new AiProviderError("unavailable")),
      }),
    );
    const thrown = providerTestResultSchema.parse(
      (await call("POST", `/admin/ai/providers/${provider.id}/test`, boss)).json(),
    );
    expect(thrown).toMatchObject({ ok: false, errorCode: "unavailable" });

    const keyless = await createProvider({ kind: "gemini" });
    spy.mockClear();
    const none = providerTestResultSchema.parse(
      (await call("POST", `/admin/ai/providers/${keyless.id}/test`, boss)).json(),
    );
    expect(none).toMatchObject({ ok: false, errorCode: "auth" });
    expect(spy).not.toHaveBeenCalled();

    expectError(
      await call("POST", `/admin/ai/providers/${MISSING_ID}/test`, boss),
      404,
      "NOT_FOUND",
    );
  });

  it("discovers models, marks the ones already added and caches the answer for 10 minutes", async () => {
    const provider = await createProvider();
    const listModelsFn = vi.fn(() =>
      Promise.resolve<DiscoveredModel[]>([
        {
          id: "disc-a",
          displayName: "Discovered A",
          contextTokens: 1000,
          capabilities: ["vision", "json"],
          pricing: {
            inputUsdMicrosPerM: 100,
            cachedInputUsdMicrosPerM: null,
            outputUsdMicrosPerM: 200,
            searchUsdMicros: null,
          },
        },
        { id: "disc-b", displayName: null, contextTokens: null, capabilities: [], pricing: null },
      ]),
    );
    stubGateway(stubAdapter({ listModels: listModelsFn }));

    const url = `/admin/ai/providers/${provider.id}/discover`;
    const first = discoverResponseSchema.parse((await call("GET", url, boss)).json());
    expect(first.cached).toBe(false);
    expect(first.items.map((item) => [item.id, item.alreadyAdded])).toEqual([
      ["disc-a", false],
      ["disc-b", false],
    ]);
    expect(first.items[0]).toMatchObject({ displayName: "Discovered A", contextTokens: 1000 });
    const ttl = await ctx.redis.ttl(`ai:discover:v1:${provider.id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);

    await createModel(provider.id, { modelId: "disc-a" });
    const second = discoverResponseSchema.parse((await call("GET", url, boss)).json());
    expect(second.cached).toBe(true);
    expect(second.items.map((item) => item.alreadyAdded)).toEqual([true, false]);
    expect(listModelsFn).toHaveBeenCalledTimes(1);

    const refreshed = discoverResponseSchema.parse(
      (await call("GET", `${url}?refresh=1`, boss)).json(),
    );
    expect(refreshed.cached).toBe(false);
    expect(listModelsFn).toHaveBeenCalledTimes(2);

    // Changing the provider drops the cache.
    await call("PATCH", `/admin/ai/providers/${provider.id}`, boss, { priority: 7 });
    expect(await ctx.redis.exists(`ai:discover:v1:${provider.id}`)).toBe(0);
  });

  it("answers 502 with the reason when the provider fails, and 404 for an unknown provider", async () => {
    const provider = await createProvider();
    stubGateway(
      stubAdapter({ listModels: () => Promise.reject(new AiProviderError("rate_limited")) }),
    );
    expectError(
      await call("GET", `/admin/ai/providers/${provider.id}/discover`, boss),
      502,
      "UPSTREAM_UNAVAILABLE",
      { reason: "rate_limited" },
    );
    expect(await ctx.redis.exists(`ai:discover:v1:${provider.id}`)).toBe(0);
    expectError(
      await call("GET", `/admin/ai/providers/${MISSING_ID}/discover`, boss),
      404,
      "NOT_FOUND",
    );
    // A real adapter without a key fails the same way, without a network call.
    vi.restoreAllMocks();
    const keyless = await createProvider({ kind: "openrouter" });
    expectError(
      await call("GET", `/admin/ai/providers/${keyless.id}/discover`, boss),
      502,
      "UPSTREAM_UNAVAILABLE",
      { reason: "auth" },
    );
  });
});

describe("models", () => {
  it("adds a model by free-text id, stamps the price check and audits it", async () => {
    const provider = await createProvider({ enabled: true });
    const modelId = "vendor/my-model:v1@2+beta";
    const model = await createModel(provider.id, {
      modelId: `  ${modelId}  `,
      displayName: "Custom",
      contextTokens: 128_000,
      priceCachedInputUsdMicrosPerM: 100_000,
      priceSearchUsdMicros: 35_000,
      creditMultiplierBp: 15_000,
    });
    expect(model).toMatchObject({
      modelId,
      displayName: "Custom",
      contextTokens: 128_000,
      priceInputUsdMicrosPerM: 1_000_000,
      priceCachedInputUsdMicrosPerM: 100_000,
      priceOutputUsdMicrosPerM: 2_000_000,
      priceSearchUsdMicros: 35_000,
      creditMultiplierBp: 15_000,
      priceSource: "manual",
      usedInRoutes: 0,
      warnings: [],
      provider: { id: provider.id, key: provider.key, kind: "fake" },
    });
    expect(model.priceCheckedAt).not.toBeNull();

    const audit = await ctx.auditRowsFor("ai.model.create", model.id);
    expect(audit[0]?.after).toMatchObject({
      providerKey: provider.key,
      modelId,
      priceInputUsdMicrosPerM: 1_000_000,
      creditMultiplierBp: 15_000,
    });

    expectError(
      await call("POST", "/admin/ai/models", boss, {
        providerId: provider.id,
        modelId,
        displayName: "Again",
        priceInputUsdMicrosPerM: 1,
        priceOutputUsdMicrosPerM: 1,
      }),
      409,
      "CONFLICT",
      { reason: "model_exists" },
    );
    // The same id under another provider is a different model.
    const other = await createProvider();
    expect((await createModel(other.id, { modelId })).modelId).toBe(modelId);
  });

  it("rejects invalid models and unknown providers", async () => {
    const provider = await createProvider();
    const base = {
      providerId: provider.id,
      modelId: `m-${uniq()}`,
      displayName: "X",
      priceInputUsdMicrosPerM: 1,
      priceOutputUsdMicrosPerM: 1,
    };
    const bad: Record<string, unknown>[] = [
      { modelId: "has space" },
      { modelId: "-leading" },
      { modelId: "" },
      { modelId: "x".repeat(201) },
      { displayName: "" },
      { displayName: "x".repeat(121) },
      { capabilities: ["telepathy"] },
      { capabilities: ["vision", "vision"] },
      { priceInputUsdMicrosPerM: -1 },
      { priceInputUsdMicrosPerM: 1.5 },
      { priceOutputUsdMicrosPerM: undefined },
      { creditMultiplierBp: 0 },
      { creditMultiplierBp: 1_000_001 },
      { priceSource: "guess" },
      { contextTokens: 0 },
    ];
    for (const patch of bad) {
      expectError(
        await call("POST", "/admin/ai/models", boss, { ...base, ...patch }),
        400,
        "VALIDATION_FAILED",
      );
    }
    expectError(
      await call("POST", "/admin/ai/models", boss, { ...base, providerId: MISSING_ID }),
      404,
      "NOT_FOUND",
    );
  });

  it("updates a model: prices stamp the check, the identity never changes", async () => {
    const provider = await createProvider();
    const model = await createModel(provider.id, { priceSearchUsdMicros: 5 });
    const old = new Date(Date.now() - 90 * 86_400_000);
    await ctx.owner.db
      .update(aiModels)
      .set({ priceCheckedAt: old, priceSource: "openrouter_sync" })
      .where(eq(aiModels.id, model.id));

    const noPrice = await call("PATCH", `/admin/ai/models/${model.id}`, boss, {
      displayName: "Renamed",
      creditMultiplierBp: 20_000,
    });
    expect(noPrice.statusCode, noPrice.body).toBe(200);
    const unchecked = modelViewSchema.parse(noPrice.json());
    expect(unchecked).toMatchObject({
      displayName: "Renamed",
      creditMultiplierBp: 20_000,
      priceSource: "openrouter_sync",
    });
    expect(unchecked.priceCheckedAt).toBe(old.toISOString());
    expect(unchecked.warnings).toContain("price_stale");

    const priced = modelViewSchema.parse(
      (
        await call("PATCH", `/admin/ai/models/${model.id}`, boss, {
          priceOutputUsdMicrosPerM: 3_000_000,
          priceSearchUsdMicros: null,
          priceCachedInputUsdMicrosPerM: 50_000,
        })
      ).json(),
    );
    expect(priced).toMatchObject({
      priceOutputUsdMicrosPerM: 3_000_000,
      priceSearchUsdMicros: 0,
      priceCachedInputUsdMicrosPerM: 50_000,
      priceSource: "manual",
    });
    expect(Date.parse(priced.priceCheckedAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(priced.warnings).not.toContain("price_stale");

    const audit = await ctx.auditRowsFor("ai.model.update", model.id);
    expect(audit).toHaveLength(2);
    expect(audit[0]?.before).toMatchObject({ priceOutputUsdMicrosPerM: 2_000_000 });
    expect(audit[0]?.after).toMatchObject({ priceOutputUsdMicrosPerM: 3_000_000 });

    for (const body of [
      {},
      { modelId: "other" },
      { providerId: MISSING_ID },
      { creditMultiplierBp: 0 },
      { priceInputUsdMicrosPerM: -5 },
    ]) {
      expectError(
        await call("PATCH", `/admin/ai/models/${model.id}`, boss, body),
        400,
        "VALIDATION_FAILED",
      );
    }
    expectError(
      await call("PATCH", `/admin/ai/models/${MISSING_ID}`, boss, { enabled: false }),
      404,
      "NOT_FOUND",
    );
  });

  it("computes warnings: unpriced, stale, preview, provider disabled", async () => {
    const provider = await createProvider();
    const model = await createModel(provider.id, {
      modelId: `exp-preview-${uniq()}`,
      priceInputUsdMicrosPerM: 0,
      priceOutputUsdMicrosPerM: 0,
    });
    expect(model.warnings).toEqual(["unpriced", "preview", "provider_disabled"]);

    await ctx.owner.db
      .update(aiModels)
      .set({ priceCheckedAt: null })
      .where(eq(aiModels.id, model.id));
    const stale = (await listModels(`?providerId=${provider.id}`)).find(
      (row) => row.id === model.id,
    );
    expect(stale?.warnings).toEqual(["unpriced", "price_stale", "preview", "provider_disabled"]);

    // Allowing preview models removes the preview warning.
    expect((await putSettings(boss, { allowPreviewModels: true })).statusCode).toBe(200);
    try {
      const allowed = (await listModels(`?providerId=${provider.id}`)).find(
        (row) => row.id === model.id,
      );
      expect(allowed?.warnings).not.toContain("preview");
    } finally {
      await putSettings(boss, { allowPreviewModels: false });
    }
  });

  it("lists the seeded models with their route usage, and filters by provider", async () => {
    const all = await listModels();
    const flash = all.find((row) => row.modelId === "gemini-3.8-flash");
    expect(flash).toMatchObject({
      provider: { key: "gemini", kind: "gemini" },
      priceInputUsdMicrosPerM: 750_000,
      priceCachedInputUsdMicrosPerM: 75_000,
      priceOutputUsdMicrosPerM: 3_750_000,
    });
    expect(flash?.usedInRoutes).toBeGreaterThan(0);
    expect(flash?.warnings).toContain("provider_disabled");
    expect(all.find((row) => row.modelId === "gemini-3.6-flash")?.warnings).toEqual(
      expect.arrayContaining(["unpriced", "price_stale"]),
    );
    expect(all.find((row) => row.modelId === "gemini-3.1-pro-preview")?.warnings).toContain(
      "preview",
    );

    const providers = providerListResponseSchema.parse(
      (await call("GET", "/admin/ai/providers", boss)).json(),
    ).items;
    const gemini = providers.find((provider) => provider.key === "gemini");
    const only = await listModels(`?providerId=${gemini?.id ?? ""}`);
    expect(only.length).toBeGreaterThan(0);
    expect(only.every((row) => row.provider.key === "gemini")).toBe(true);
    expectError(
      await call("GET", "/admin/ai/models?providerId=nope", boss),
      400,
      "VALIDATION_FAILED",
    );
  });

  it("refuses to disable a model that leads a route, or delete one a route lists", async () => {
    const all = await listModels();
    const flash = all.find((row) => row.modelId === "gemini-3.8-flash");
    expect(flash).toBeDefined();
    const res = await call("PATCH", `/admin/ai/models/${flash?.id ?? ""}`, boss, {
      enabled: false,
    });
    expectError(res, 409, "CONFLICT", { reason: "model_is_primary" });
    expect(res.json<{ details: { routes: number } }>().details.routes).toBeGreaterThan(0);
    expect((await listModels()).find((row) => row.id === flash?.id)?.enabled).toBe(true);

    expectError(
      await call("DELETE", `/admin/ai/models/${flash?.id ?? ""}`, boss),
      409,
      "CONFLICT",
      {
        reason: "model_in_use",
      },
    );
    // A fallback-only model is protected from deletion too.
    const fallback = all.find((row) => row.modelId === "gemini-3.6-flash");
    expectError(
      await call("DELETE", `/admin/ai/models/${fallback?.id ?? ""}`, boss),
      409,
      "CONFLICT",
      {
        reason: "model_in_use",
      },
    );
  });

  it("deletes an unused model and audits it", async () => {
    const provider = await createProvider();
    const model = await createModel(provider.id);
    const gone = await call("DELETE", `/admin/ai/models/${model.id}`, boss);
    expect(gone.statusCode, gone.body).toBe(204);
    const audit = await ctx.auditRowsFor("ai.model.delete", model.id);
    expect(audit[0]?.before).toMatchObject({ providerKey: provider.key, modelId: model.modelId });
    expectError(await call("DELETE", `/admin/ai/models/${model.id}`, boss), 404, "NOT_FOUND");
  });
});

describe("price sync from OpenRouter", () => {
  const pricing = (
    input: number,
    output: number,
    cached: number | null,
    search: number | null,
  ) => ({
    inputUsdMicrosPerM: input,
    cachedInputUsdMicrosPerM: cached,
    outputUsdMicrosPerM: output,
    searchUsdMicros: search,
  });
  const discovered = (id: string, price: ReturnType<typeof pricing> | null): DiscoveredModel => ({
    id,
    displayName: id,
    contextTokens: null,
    capabilities: [],
    pricing: price,
  });

  it("previews a diff, applies a subset, and refuses a reused, foreign or unknown token", async () => {
    const orKey = providerKey();
    const openrouter = await createProvider({
      key: orKey,
      kind: "openrouter",
      dataPolicy: "zdr",
      apiKey: "or-key-1234567890",
    });
    const geminiKind = await createProvider({ kind: "gemini" });
    const direct = await createProvider();
    const viaGoogle = await createModel(geminiKind.id, {
      modelId: `sync-g-${uniq()}`,
      priceInputUsdMicrosPerM: 100,
      priceOutputUsdMicrosPerM: 200,
      priceCachedInputUsdMicrosPerM: 10,
    });
    const exact = await createModel(direct.id, {
      modelId: `sync-d-${uniq()}`,
      priceInputUsdMicrosPerM: 500,
      priceOutputUsdMicrosPerM: 600,
      priceSearchUsdMicros: 7,
    });
    const same = await createModel(direct.id, {
      modelId: `sync-same-${uniq()}`,
      priceInputUsdMicrosPerM: 11,
      priceOutputUsdMicrosPerM: 22,
    });

    stubGateway(
      stubAdapter({
        listModels: () =>
          Promise.resolve([
            // Gemini model: matched as `google/<id>`; cached price unreported, so it stays.
            discovered(`google/${viaGoogle.modelId}`, pricing(150, 250, null, null)),
            discovered(exact.modelId, pricing(500, 650, 20, null)),
            discovered(same.modelId, pricing(11, 22, null, null)),
            discovered("unrelated/model", pricing(1, 1, null, null)),
          ]),
      }),
    );

    const res = await call("POST", "/admin/ai/models/price-sync/preview", boss);
    expect(res.statusCode, res.body).toBe(200);
    const preview = priceSyncPreviewSchema.parse(res.json());
    const mine = preview.changes.filter((change) =>
      [viaGoogle.id, exact.id, same.id].includes(change.modelId),
    );
    expect(mine.map((change) => [change.model, change.field, change.before, change.after])).toEqual(
      expect.arrayContaining([
        [viaGoogle.modelId, "priceInputUsdMicrosPerM", 100, 150],
        [viaGoogle.modelId, "priceOutputUsdMicrosPerM", 200, 250],
        [exact.modelId, "priceOutputUsdMicrosPerM", 600, 650],
        [exact.modelId, "priceCachedInputUsdMicrosPerM", null, 20],
      ]),
    );
    expect(mine).toHaveLength(4);
    expect(mine.every((change) => change.model !== same.modelId)).toBe(true);
    expect(mine.find((change) => change.model === viaGoogle.modelId)?.providerKey).toBe(
      geminiKind.key,
    );
    const totalModels = (await listModels()).length;
    expect(preview.unmatched).toBe(totalModels - 3);
    const ttl = await ctx.redis.ttl(`ai:pricesync:v1:${preview.token}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);

    // Nothing is written by a preview.
    expect((await listModels()).find((row) => row.id === exact.id)?.priceOutputUsdMicrosPerM).toBe(
      600,
    );

    // Another admin cannot apply this diff.
    const other = await ctx.admin("super_admin");
    expectError(
      await call("POST", "/admin/ai/models/price-sync/apply", other, { token: preview.token }),
      409,
      "CONFLICT",
      { reason: "sync_expired" },
    );

    const applied = await call("POST", "/admin/ai/models/price-sync/apply", boss, {
      token: preview.token,
      modelIds: [exact.id],
    });
    expect(applied.statusCode, applied.body).toBe(200);
    expect(priceSyncApplyResultSchema.parse(applied.json())).toEqual({ models: 1, changes: 2 });

    const after = await listModels();
    const exactAfter = after.find((row) => row.id === exact.id);
    expect(exactAfter).toMatchObject({
      priceOutputUsdMicrosPerM: 650,
      priceCachedInputUsdMicrosPerM: 20,
      priceInputUsdMicrosPerM: 500,
      // Not reported by OpenRouter: ours stays.
      priceSearchUsdMicros: 7,
      priceSource: "openrouter_sync",
    });
    expect(Date.parse(exactAfter?.priceCheckedAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    // Not in the chosen subset.
    expect(after.find((row) => row.id === viaGoogle.id)).toMatchObject({
      priceInputUsdMicrosPerM: 100,
      priceSource: "manual",
    });

    const audit = await ctx.owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "ai.model.price_sync"));
    expect(audit.at(-1)?.after).toEqual({ models: 1, changes: 2 });

    // One use per preview, and a made-up token is just as expired.
    expectError(
      await call("POST", "/admin/ai/models/price-sync/apply", boss, { token: preview.token }),
      409,
      "CONFLICT",
      { reason: "sync_expired" },
    );
    expectError(
      await call("POST", "/admin/ai/models/price-sync/apply", boss, { token: "b".repeat(32) }),
      409,
      "CONFLICT",
      { reason: "sync_expired" },
    );
    expectError(
      await call("POST", "/admin/ai/models/price-sync/apply", boss, { token: "not a token" }),
      400,
      "VALIDATION_FAILED",
    );

    // The whole diff when no subset is given.
    const again = priceSyncPreviewSchema.parse(
      (await call("POST", "/admin/ai/models/price-sync/preview", boss)).json(),
    );
    const everything = priceSyncApplyResultSchema.parse(
      (
        await call("POST", "/admin/ai/models/price-sync/apply", boss, { token: again.token })
      ).json(),
    );
    expect(everything).toEqual({ models: 1, changes: 2 });
    expect((await listModels()).find((row) => row.id === viaGoogle.id)).toMatchObject({
      priceInputUsdMicrosPerM: 150,
      priceOutputUsdMicrosPerM: 250,
      priceCachedInputUsdMicrosPerM: 10,
    });

    // A provider failure is a 502 with the reason; a source without a key is not a source.
    vi.restoreAllMocks();
    stubGateway(stubAdapter({ listModels: () => Promise.reject(new AiProviderError("auth")) }));
    expectError(
      await call("POST", "/admin/ai/models/price-sync/preview", boss),
      502,
      "UPSTREAM_UNAVAILABLE",
      { reason: "auth" },
    );
    await call("PATCH", `/admin/ai/providers/${openrouter.id}`, boss, { clearKey: true });
    expectError(await call("POST", "/admin/ai/models/price-sync/preview", boss), 409, "CONFLICT", {
      reason: "no_price_source",
    });
  });
});

describe("routes", () => {
  let planId: string;
  let planKey: string;
  let a: ModelView;
  let b: ModelView;
  let noCaps: ModelView;
  let disabled: ModelView;
  let preview: ModelView;
  let freeTier: ModelView;

  beforeAll(async () => {
    const plan = await call("POST", "/admin/plans", boss, {
      key: `route_plan_${uniq()}`,
      nameAr: "ا",
      nameEn: "Route plan",
      monthlyCredits: 1,
    });
    const view = planViewSchema.parse(plan.json());
    planId = view.id;
    planKey = view.key;

    const paid = await createProvider({ enabled: true });
    const free = await createProvider({ enabled: true, dataPolicy: "free_tier" });
    const named = (displayName: string, extra: Record<string, unknown> = {}) => ({
      displayName,
      ...extra,
    });
    a = await createModel(
      paid.id,
      named("Route A", { capabilities: ["vision", "json", "search", "thinking"] }),
    );
    b = await createModel(paid.id, named("Route B", { capabilities: ["vision", "json"] }));
    noCaps = await createModel(paid.id, named("Route C", { capabilities: ["thinking"] }));
    disabled = await createModel(paid.id, named("Route D", { enabled: false }));
    preview = await createModel(paid.id, named("Route E", { modelId: `rt-preview-${uniq()}` }));
    freeTier = await createModel(
      free.id,
      named("Route F", { capabilities: ["vision", "json", "search"] }),
    );
  }, 60_000);

  const entry = (model: ModelView, params: Record<string, unknown> = {}) => ({
    modelId: model.id,
    params,
  });
  const put = (body: Record<string, unknown>, who: { jar: Person["jar"] } = boss) =>
    call("PUT", "/admin/ai/routes", who, { planId, mode: "fast", ...body });

  it("lists the seeded default routes and the task x mode matrix", async () => {
    const res = await call("GET", "/admin/ai/routes", boss);
    expect(res.statusCode, res.body).toBe(200);
    const list = routeListResponseSchema.parse(res.json());
    const defaults = list.items.filter((item) => item.planId === null);
    expect(defaults.length).toBeGreaterThanOrEqual(24);
    expect(list.matrix).toHaveLength(24);
    expect(list.matrix.every((cell) => cell.routeId !== null)).toBe(true);

    const extract = defaults.find((item) => item.task === "rx_extract" && item.mode === "fast");
    expect(extract?.models).toHaveLength(3);
    expect(extract?.models[0]).toMatchObject({
      params: { thinking: "low", mediaResolution: "high", temperature: 0, jsonSchema: true },
      model: { modelId: "gemini-3.8-flash", providerKey: "gemini", priceInput: 750_000 },
    });
    expect(extract?.warnings.some((warning) => warning.reason === "provider_disabled")).toBe(true);
    const search = defaults.find((item) => item.task === "web_search" && item.mode === "fast");
    expect(search?.models[0]?.params).toEqual({ search: true });
  });

  it("creates a plan route (version 1), bumps the version and audits names without ids", async () => {
    const first = await put({
      task: "rx_extract",
      models: [entry(a, { thinking: "low", temperature: 0 }), entry(b)],
    });
    expect(first.statusCode, first.body).toBe(200);
    const created = routeViewSchema.parse(first.json());
    expect(created).toMatchObject({
      task: "rx_extract",
      planId,
      planKey,
      mode: "fast",
      version: 1,
      warnings: [],
    });
    expect(created.models.map((row) => row.model?.displayName)).toEqual(["Route A", "Route B"]);
    expect(created.models[0]?.params).toEqual({ thinking: "low", temperature: 0 });

    const second = routeViewSchema.parse(
      (await put({ task: "rx_extract", models: [entry(b), entry(a)], expectedVersion: 1 })).json(),
    );
    expect(second).toMatchObject({ id: created.id, version: 2 });
    expect(second.models.map((row) => row.model?.displayName)).toEqual(["Route B", "Route A"]);

    const audit = await ctx.auditRowsFor("ai.route.update", created.id);
    expect(audit).toHaveLength(2);
    expect(audit[1]?.before).toBeNull();
    expect(audit[1]?.after).toEqual({
      task: "rx_extract",
      mode: "fast",
      planKey,
      version: 1,
      models: ["Route A", "Route B"],
    });
    expect(audit[0]?.before).toMatchObject({ version: 1, models: ["Route A", "Route B"] });
    expect(audit[0]?.after).toMatchObject({ version: 2, models: ["Route B", "Route A"] });

    // The grid shows it next to the defaults.
    const list = routeListResponseSchema.parse(
      (await call("GET", "/admin/ai/routes", boss)).json(),
    );
    expect(list.items.find((item) => item.id === created.id)).toMatchObject({
      planKey,
      version: 2,
    });
  });

  it("refuses a save made on an older version", async () => {
    await put({ task: "classify", models: [entry(b)] });
    await put({ task: "classify", models: [entry(a)] });
    expectError(
      await put({ task: "classify", models: [entry(b)], expectedVersion: 1 }),
      409,
      "CONFLICT",
      { reason: "stale_version" },
    );
    // An editor that loaded a route that is not there any more.
    expectError(
      await put({ task: "summarize", models: [entry(b)], expectedVersion: 3 }),
      409,
      "CONFLICT",
      { reason: "stale_version" },
    );
    const ok = routeViewSchema.parse(
      (await put({ task: "classify", models: [entry(b)], expectedVersion: 2 })).json(),
    );
    expect(ok.version).toBe(3);
  });

  it("validates every model: reason and index", async () => {
    const cases: [string, Record<string, unknown>, string, number][] = [
      [
        "unknown model",
        { task: "chat", models: [entry(a), { modelId: MISSING_ID, params: {} }] },
        "unknown_model",
        1,
      ],
      [
        "disabled primary",
        { task: "chat", models: [entry(disabled), entry(a)] },
        "primary_disabled",
        0,
      ],
      [
        "no vision/json for rx_extract",
        { task: "rx_extract", models: [entry(a), entry(noCaps)] },
        "missing_capability",
        1,
      ],
      [
        "no vision/json for rx_verify",
        { task: "rx_verify", models: [entry(noCaps)] },
        "missing_capability",
        0,
      ],
      [
        "no search for web_search",
        { task: "web_search", models: [entry(b)] },
        "missing_capability",
        0,
      ],
      [
        "search param without search",
        { task: "chat", models: [entry(a), entry(b, { search: true })] },
        "missing_capability",
        1,
      ],
      [
        "free tier for chat",
        { task: "chat", models: [entry(a), entry(freeTier)] },
        "free_tier_medical",
        1,
      ],
      [
        "free tier for rx_extract",
        { task: "rx_extract", models: [entry(freeTier)] },
        "free_tier_medical",
        0,
      ],
      [
        "free tier for rx_verify",
        { task: "rx_verify", models: [entry(freeTier)] },
        "free_tier_medical",
        0,
      ],
      [
        "free tier for deep_think",
        { task: "deep_think", models: [entry(freeTier)] },
        "free_tier_medical",
        0,
      ],
      [
        "preview model",
        { task: "chat", models: [entry(a), entry(preview)] },
        "preview_not_allowed",
        1,
      ],
    ];
    for (const [name, body, reason, index] of cases) {
      const res = await put(body);
      expect(res.statusCode, `${name}: ${res.body}`).toBe(400);
      expect(res.json(), name).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { reason, index },
      });
    }
  });

  it("allows what the rules allow: free-tier models for non-medical tasks, preview when enabled, disabled fallbacks with a warning", async () => {
    const title = await put({ task: "title_gen", models: [entry(freeTier), entry(b)] });
    expect(title.statusCode, title.body).toBe(200);
    expect(
      (await put({ task: "web_search", models: [entry(freeTier, { search: true })] })).statusCode,
    ).toBe(200);

    const fallback = routeViewSchema.parse(
      (await put({ task: "chat", mode: "balanced", models: [entry(a), entry(disabled)] })).json(),
    );
    expect(fallback.warnings).toEqual([{ reason: "model_disabled", index: 1 }]);

    expect((await putSettings(boss, { allowPreviewModels: true })).statusCode).toBe(200);
    try {
      const allowed = await put({ task: "chat", mode: "deep", models: [entry(a), entry(preview)] });
      expect(allowed.statusCode, allowed.body).toBe(200);
    } finally {
      await putSettings(boss, { allowPreviewModels: false });
    }
  });

  it("rejects malformed bodies with 400 and an unknown plan with 404", async () => {
    const bad: Record<string, unknown>[] = [
      { task: "chat", models: [] },
      { task: "chat", models: [entry(a), entry(a)] },
      {
        task: "chat",
        models: [
          entry(a),
          entry(b),
          entry(noCaps),
          entry(disabled),
          entry(preview),
          entry(freeTier),
          entry(a),
        ],
      },
      { task: "chat", models: [{ modelId: "not-a-uuid", params: {} }] },
      { task: "chat", models: [entry(a, { colour: "red" })] },
      { task: "chat", models: [entry(a, { thinking: "extreme" })] },
      { task: "chat", models: [entry(a, { temperature: 3 })] },
      { task: "chat", models: [entry(a, { maxOutputTokens: 0 })] },
      { task: "telepathy", models: [entry(a)] },
      { task: "chat", mode: "turbo", models: [entry(a)] },
      { task: "chat", models: [entry(a)], expectedVersion: 0 },
    ];
    for (const body of bad) {
      expectError(await put(body), 400, "VALIDATION_FAILED");
    }
    expectError(
      await put({ task: "chat", planId: MISSING_ID, models: [entry(a)] }),
      404,
      "NOT_FOUND",
    );
  });

  it("protects models used by routes: no delete, and no disabling of a primary", async () => {
    await put({ task: "summarize", models: [entry(a), entry(noCaps)] });
    expectError(await call("DELETE", `/admin/ai/models/${a.id}`, boss), 409, "CONFLICT", {
      reason: "model_in_use",
    });
    expectError(await call("DELETE", `/admin/ai/models/${noCaps.id}`, boss), 409, "CONFLICT", {
      reason: "model_in_use",
    });
    const res = await call("PATCH", `/admin/ai/models/${a.id}`, boss, { enabled: false });
    expectError(res, 409, "CONFLICT", { reason: "model_is_primary" });
    expect(res.json<{ details: { routes: number } }>().details.routes).toBeGreaterThanOrEqual(1);
    // noCaps leads no route, so it can be switched off; routes keep it as a warned fallback.
    const switchedOff = await call("PATCH", `/admin/ai/models/${noCaps.id}`, boss, {
      enabled: false,
    });
    expect(switchedOff.statusCode, switchedOff.body).toBe(200);
    const list = routeListResponseSchema.parse(
      (await call("GET", "/admin/ai/routes", boss)).json(),
    );
    const summarize = list.items.find(
      (item) => item.task === "summarize" && item.planId === planId,
    );
    expect(summarize?.warnings).toEqual([{ reason: "model_disabled", index: 1 }]);
    expect(
      (await listModels()).find((row) => row.id === a.id)?.usedInRoutes,
    ).toBeGreaterThanOrEqual(1);
    await call("PATCH", `/admin/ai/models/${noCaps.id}`, boss, { enabled: true });
  });

  it("deletes a plan route, and refuses to delete a default one", async () => {
    const list = routeListResponseSchema.parse(
      (await call("GET", "/admin/ai/routes", boss)).json(),
    );
    const planRoute = list.items.find(
      (item) => item.planId === planId && item.task === "title_gen",
    );
    const defaultRoute = list.items.find((item) => item.planId === null);
    expect(planRoute).toBeDefined();
    expectError(
      await call("DELETE", `/admin/ai/routes/${defaultRoute?.id ?? ""}`, boss),
      409,
      "CONFLICT",
      {
        reason: "default_route",
      },
    );

    const gone = await call("DELETE", `/admin/ai/routes/${planRoute?.id ?? ""}`, boss);
    expect(gone.statusCode, gone.body).toBe(204);
    const audit = await ctx.auditRowsFor("ai.route.delete", planRoute?.id ?? "");
    expect(audit[0]?.before).toMatchObject({
      task: "title_gen",
      planKey,
      models: ["Route F", "Route B"],
    });
    expectError(
      await call("DELETE", `/admin/ai/routes/${planRoute?.id ?? ""}`, boss),
      404,
      "NOT_FOUND",
    );
    const after = routeListResponseSchema.parse(
      (await call("GET", "/admin/ai/routes", boss)).json(),
    );
    expect(after.items.some((item) => item.id === planRoute?.id)).toBe(false);
  });

  it("a route saved through the API is a full route for the same key: the default is edited, not duplicated", async () => {
    const before = routeListResponseSchema.parse(
      (await call("GET", "/admin/ai/routes", boss)).json(),
    );
    const seeded = before.items.find(
      (item) => item.planId === null && item.task === "title_gen" && item.mode === "fast",
    );
    expect(seeded).toBeDefined();
    const flashLite = seeded?.models[0];
    const res = await call("PUT", "/admin/ai/routes", boss, {
      task: "title_gen",
      planId: null,
      mode: "fast",
      models: seeded?.models.map((row) => ({ modelId: row.modelId, params: row.params })) ?? [],
      expectedVersion: seeded?.version,
    });
    expect(res.statusCode, res.body).toBe(200);
    const saved: RouteView = routeViewSchema.parse(res.json());
    expect(saved).toMatchObject({
      id: seeded?.id,
      version: (seeded?.version ?? 0) + 1,
      planKey: null,
    });
    expect(saved.models[0]?.modelId).toBe(flashLite?.modelId);
    const after = routeListResponseSchema.parse(
      (await call("GET", "/admin/ai/routes", boss)).json(),
    );
    expect(after.matrix).toHaveLength(24);
    expect(
      after.items.filter(
        (item) => item.planId === null && item.task === "title_gen" && item.mode === "fast",
      ),
    ).toHaveLength(1);
  });
});

describe("AI settings", () => {
  it("reads the stored setting with the time it changed", async () => {
    const { value } = await getSettings();
    expect(value).toMatchObject(SETTINGS);
  });

  it("saves a full value through SettingsService and audits it there", async () => {
    try {
      const res = await putSettings(boss, { dailyCapUsdMicros: 25_000_000, alertPercent: 70 });
      expect(res.statusCode, res.body).toBe(200);
      const saved = aiSettingsResponseSchema.parse(res.json());
      expect(saved.value).toMatchObject({ dailyCapUsdMicros: 25_000_000, alertPercent: 70 });
      expect(saved.updatedAt).not.toBeNull();
      expect((await getSettings()).value.dailyCapUsdMicros).toBe(25_000_000);

      const rows = await ctx.owner.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, "setting.update"));
      const mine = rows.filter((row) => row.targetId === "ai" && row.actorId === boss.userId);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(mine.at(-1)?.after).toMatchObject({ dailyCapUsdMicros: 25_000_000 });
    } finally {
      await putSettings(boss, SETTINGS);
    }
  });

  it("rejects partial or invalid values and stores nothing", async () => {
    const bad: Record<string, unknown>[] = [
      {},
      { dailyCapUsdMicros: 1 },
      { ...SETTINGS, dailyCapUsdMicros: -1 },
      { ...SETTINGS, dailyCapUsdMicros: 1.5 },
      { ...SETTINGS, alertPercent: 0 },
      { ...SETTINGS, alertPercent: 101 },
      { ...SETTINGS, creditValueUsdMicros: 0 },
      { ...SETTINGS, killSwitch: { all: true } },
      { ...SETTINGS, allowPreviewModels: "yes" },
    ];
    for (const body of bad) {
      expectError(await call("PUT", "/admin/ai/settings", boss, body), 400, "VALIDATION_FAILED");
    }
    expect((await getSettings()).value).toMatchObject(SETTINGS);
  });

  it("changes a kill switch only with ai.killswitch", async () => {
    const writer = await ctx.admin(await ctx.customRole(["ai.read", "ai.write"]));
    const stopper = await ctx.admin(await ctx.customRole(["ai.read", "ai.write", "ai.killswitch"]));
    try {
      // Anything but a kill switch is fine for the writer.
      expect((await putSettings(writer, { dailyCapUsdMicros: 11_000_000 })).statusCode).toBe(200);

      const refused = await putSettings(writer, {
        killSwitch: { ...SETTINGS.killSwitch, chat: true },
      });
      expectError(refused, 403, "FORBIDDEN", { reason: "killswitch_permission" });
      expect((await getSettings()).value.killSwitch.chat).toBe(false);

      // Sending the stored switches unchanged is not a change.
      expect((await putSettings(writer, { alertPercent: 60 })).statusCode).toBe(200);

      const allowed = await putSettings(stopper, {
        killSwitch: { ...SETTINGS.killSwitch, chat: true },
      });
      expect(allowed.statusCode, allowed.body).toBe(200);
      expect((await getSettings()).value.killSwitch).toEqual({
        all: false,
        rx: false,
        chat: true,
        search: false,
      });

      // Switching it back off needs the right too.
      expectError(
        await putSettings(writer, { killSwitch: SETTINGS.killSwitch }),
        403,
        "FORBIDDEN",
        { reason: "killswitch_permission" },
      );
      expect((await putSettings(boss, { killSwitch: SETTINGS.killSwitch })).statusCode).toBe(200);
      expect((await getSettings()).value.killSwitch.chat).toBe(false);
    } finally {
      await putSettings(boss, SETTINGS);
    }
  });

  it("still refuses the generic settings route for the ai key", async () => {
    expectError(
      await call("PUT", "/admin/settings/ai", boss, { value: { dailyCapUsdMicros: 99_000_000 } }),
      403,
      "FORBIDDEN",
      { reason: "use_admin_ai" },
    );
    expect((await getSettings()).value.dailyCapUsdMicros).toBe(SETTINGS.dailyCapUsdMicros);
  });
});
