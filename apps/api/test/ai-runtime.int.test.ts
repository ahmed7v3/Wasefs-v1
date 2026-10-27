import { randomUUID } from "node:crypto";

import {
  aiModels,
  aiProviders,
  aiTaskRoutes,
  aiUsage,
  createAiRuntimePorts,
  plans,
} from "@wasfa/db";
import { decryptSecret } from "@wasfa/shared/crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AiGatewayFactory } from "../src/admin/ai/ai-gateway.factory.js";
import { AiRuntimeModule } from "../src/ai-runtime/ai-runtime.module.js";
import { AiRuntimeService, isSwitchedOff } from "../src/ai-runtime/ai-runtime.service.js";
import { providerKeyContext } from "../src/ai-runtime/provider-key.js";
import { encryptionKey } from "../src/config/env.js";

import { AdminTestContext } from "./support/admin-context.js";

import type { RouterEvent, RouterInput } from "@wasfa/ai";

/*
 * The router wired to the real database and Redis, with the `fake` provider standing in for a
 * model: route lookup (plan route over the default), usage rows written as the restricted API role,
 * fallback on a retryable error, and provider keys decrypted with the provider-bound context.
 */

const ctx = new AdminTestContext();
let runtime: AiRuntimeService;
let freePlanId: string;
let proPlanId: string;
let fakeProviderId: string;
let primaryModelId: string; // fake-error-retryable: always fails with a retryable error
let echoModelId: string; // fake-echo: echoes the last user message

beforeAll(async () => {
  await ctx.start([AiRuntimeModule]);
  runtime = ctx.app.get(AiRuntimeService);

  const planRows = await ctx.owner.db.select({ id: plans.id, key: plans.key }).from(plans);
  const planId = (key: string) => {
    const found = planRows.find((row) => row.key === key);
    if (!found) throw new Error(`plan ${key} missing`);
    return found.id;
  };
  freePlanId = planId("free");
  proPlanId = planId("pro");

  const [provider] = await ctx.owner.db
    .insert(aiProviders)
    .values({ key: "fake-test", kind: "fake", dataPolicy: "paid_no_training", enabled: true })
    .returning({ id: aiProviders.id });
  if (!provider) throw new Error("provider insert failed");
  fakeProviderId = provider.id;

  const prices = {
    priceInputUsdMicrosPerM: 1_000_000,
    priceOutputUsdMicrosPerM: 1_000_000,
    creditMultiplierBp: 20_000,
  };
  const models = await ctx.owner.db
    .insert(aiModels)
    .values([
      {
        providerId: fakeProviderId,
        modelId: "fake-error-retryable",
        displayName: "Fake failing",
        capabilities: ["json"],
        ...prices,
      },
      {
        providerId: fakeProviderId,
        modelId: "fake-echo",
        displayName: "Fake echo",
        capabilities: ["json"],
        ...prices,
      },
    ])
    .returning({ id: aiModels.id, modelId: aiModels.modelId });
  const idOf = (modelId: string) => {
    const found = models.find((row) => row.modelId === modelId);
    if (!found) throw new Error(`model ${modelId} missing`);
    return found.id;
  };
  primaryModelId = idOf("fake-error-retryable");
  echoModelId = idOf("fake-echo");

  // The free plan's own route for `summarize`/`fast`: the failing model first, the echo as fallback.
  await ctx.owner.db.insert(aiTaskRoutes).values({
    task: "summarize",
    mode: "fast",
    planId: freePlanId,
    version: 4,
    models: [
      { modelId: primaryModelId, params: {} },
      { modelId: echoModelId, params: { temperature: 0 } },
    ],
  });
  // The default route for `classify`/`fast` points at the echo model (seeded default is gemini, disabled).
  await ctx.owner.db
    .update(aiTaskRoutes)
    .set({ models: [{ modelId: echoModelId, params: {} }], version: 9 })
    .where(
      and(
        eq(aiTaskRoutes.task, "classify"),
        eq(aiTaskRoutes.mode, "fast"),
        isNull(aiTaskRoutes.planId),
      ),
    );
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function collect(input: RouterInput): Promise<{ events: RouterEvent[]; error: unknown }> {
  const events: RouterEvent[] = [];
  try {
    for await (const event of runtime.run(input, new AbortController().signal)) events.push(event);
  } catch (error) {
    return { events, error };
  }
  return { events, error: undefined };
}

const input = (overrides: Partial<RouterInput>): RouterInput => ({
  task: "summarize",
  mode: "fast",
  planId: freePlanId,
  request: {
    messages: [{ role: "user", parts: [{ type: "text", text: "summarize this please" }] }],
    maxOutputTokens: 100,
  },
  requestId: randomUUID(),
  ...overrides,
});

describe("AiRuntimeService", () => {
  it("uses the plan's route, falls back on a retryable error and stores one usage row per attempt", async () => {
    const userId = await ctx.insertUser({
      name: "Runtime Person",
      email: `r${randomUUID().slice(0, 8)}@example.com`,
    });
    const requestId = randomUUID();
    const { events, error } = await collect(input({ ownerUserId: userId, userId, requestId }));

    expect(error).toBeUndefined();
    const text = events.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");
    expect(text).toBe("summarize this please");
    const last = events.at(-1);
    expect(last?.type).toBe("result");
    if (last?.type !== "result") return;
    expect(last.result).toMatchObject({
      outcome: "ok",
      modelId: echoModelId,
      routeVersion: 4,
      creditMultiplierBp: 20_000,
      attempts: 2,
    });
    // fake-echo reported ceil(21/4)=6 input and ceil(21/4)=6 output tokens at $1 per 1M each.
    expect(last.result.costUsdMicros).toBe(12);

    const rows = await ctx.owner.db.select().from(aiUsage).where(eq(aiUsage.requestId, requestId));
    expect(rows.map((row) => row.outcome).sort()).toEqual(["error", "ok"]);
    const failed = rows.find((row) => row.outcome === "error");
    const ok = rows.find((row) => row.outcome === "ok");
    expect(failed).toMatchObject({
      modelId: primaryModelId,
      providerId: fakeProviderId,
      modelKey: "fake-error-retryable",
      costUsdMicros: 0,
      routeVersion: 4,
      task: "summarize",
      ownerUserId: userId,
      userId,
    });
    expect(ok).toMatchObject({
      modelId: echoModelId,
      costUsdMicros: 12,
      inputTokens: 6,
      outputTokens: 6,
      creditsCharged: 0,
      cacheHit: false,
    });
    expect(last.result.usageId).toBe(ok?.id);
    // No content columns: the row holds numbers and ids only.
    expect(JSON.stringify(rows)).not.toContain("summarize this please");
  });

  it("falls back to the default route for a plan without its own", async () => {
    const { events, error } = await collect(
      input({ task: "classify", planId: proPlanId, requestId: randomUUID() }),
    );
    expect(error).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      type: "result",
      result: { modelId: echoModelId, routeVersion: 9 },
    });
  });

  it("refuses with no_model when the route only has disabled providers", async () => {
    // The seeded default for `chat`/`fast` points at the (disabled) Gemini provider.
    const { error } = await collect(input({ task: "chat", planId: null }));
    expect(error).toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      details: { reason: "no_model" },
    });
  });

  it("books today's spend in Redis and corrects it to the real cost", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const before = Number((await ctx.redis.get(`ai:spend:${day}`)) ?? 0);
    await collect(input({ requestId: randomUUID() }));
    const after = Number((await ctx.redis.get(`ai:spend:${day}`)) ?? 0);
    expect(after - before).toBe(12);
    expect(await ctx.redis.ttl(`ai:spend:${day}`)).toBeGreaterThan(0);
  });
});

describe("provider keys", () => {
  it("are decrypted with the provider-bound context and nowhere else", async () => {
    const gateway = ctx.app.get(AiGatewayFactory, { strict: false });
    const sealed = gateway.seal("keyed-provider", "sk-test-secret-1234");
    const [provider] = await ctx.owner.db
      .insert(aiProviders)
      .values({
        key: "keyed-provider",
        kind: "openai_compatible",
        baseUrl: "https://example.test/v1",
        dataPolicy: "paid_no_training",
        enabled: true,
        ...sealed,
      })
      .returning({ id: aiProviders.id });
    if (!provider) throw new Error("provider insert failed");
    const [model] = await ctx.owner.db
      .insert(aiModels)
      .values({ providerId: provider.id, modelId: "m", displayName: "M" })
      .returning({ id: aiModels.id });
    if (!model) throw new Error("model insert failed");
    await ctx.owner.db.insert(aiTaskRoutes).values({
      task: "title_gen",
      mode: "fast",
      planId: freePlanId,
      models: [{ modelId: model.id, params: {} }],
    });

    const key = encryptionKey(ctx.env);
    const ports = createAiRuntimePorts(ctx.owner.db, (providerKey, enc) =>
      decryptSecret(enc, key, providerKeyContext(providerKey)),
    );
    const route = await ports.resolveRoute("title_gen", freePlanId, "fast");
    expect(route?.attempts[0]?.model.provider.apiKey).toBe("sk-test-secret-1234");

    // A ciphertext that no longer decrypts leaves the provider without a key, never a crash.
    const broken = createAiRuntimePorts(ctx.owner.db, () => {
      throw new Error("bad key");
    });
    const unkeyed = await broken.resolveRoute("title_gen", freePlanId, "fast");
    expect(unkeyed?.attempts[0]?.model.provider.apiKey).toBeNull();
  });
});

describe("kill switch mapping", () => {
  const off = { all: false, rx: false, chat: false, search: false, wa_agent: false };

  it("stops everything on `all`, a feature on its own switch, and search on `search`", () => {
    expect(isSwitchedOff({ ...off, all: true }, "title_gen", { search: false })).toBe(true);
    expect(isSwitchedOff({ ...off, rx: true }, "rx_extract", { search: false })).toBe(true);
    expect(isSwitchedOff({ ...off, rx: true }, "rx_verify", { search: false })).toBe(true);
    expect(isSwitchedOff({ ...off, rx: true }, "chat", { search: false })).toBe(false);
    expect(isSwitchedOff({ ...off, chat: true }, "deep_think", { search: false })).toBe(true);
    expect(isSwitchedOff({ ...off, search: true }, "web_search", { search: false })).toBe(true);
    expect(isSwitchedOff({ ...off, search: true }, "chat", { search: false })).toBe(false);
    expect(isSwitchedOff({ ...off, search: true }, "chat", { search: true })).toBe(true);
    expect(isSwitchedOff(off, "chat", { search: true })).toBe(false);
  });
});
