import { isAiSwitchedOff } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import {
  AiProviderError,
  MemoryBreakerStore,
  RedisBreakerStore,
  createRouter,
  createSpendGuard,
} from "../src/index.js";

import { FakeRedis } from "./fake-redis.js";

import type {
  AIProviderAdapter,
  NormalizedEvent,
  NormalizedRequest,
  ResolvedRoute,
  RouterEvent,
  RouterInput,
  RouterModel,
  RouterNote,
  RouterPorts,
  UsageRecord,
} from "../src/index.js";
import type { AiProviderKind, AiTask } from "@wasfa/shared/ai";

const USAGE = {
  inputTokens: 1_000,
  cachedInputTokens: 0,
  outputTokens: 100,
  thinkingTokens: 0,
  searchCount: 0,
};
// 1_000 x 750_000 / 1M = 750, plus 100 x 3_750_000 / 1M = 375.
const USAGE_COST = 1_125;

const okScript: NormalizedEvent[] = [
  { type: "text", text: "hi" },
  { type: "usage", usage: USAGE },
  { type: "done", finishReason: "stop" },
];

type Script = (NormalizedEvent | Error)[];

function adapter(script: Script, onCall?: () => void): AIProviderAdapter {
  return {
    async *stream() {
      onCall?.();
      for (const step of script) {
        if (step instanceof Error) throw step;
        yield step;
      }
    },
    listModels: () => Promise.resolve([]),
    testConnection: () => Promise.resolve({ ok: true, latencyMs: 0 }),
  };
}

function model(id: string, overrides: Partial<RouterModel> = {}): RouterModel {
  return {
    id,
    modelId: `provider-${id}`,
    provider: {
      id: `prov-${id}`,
      key: `key-${id}`,
      kind: "gemini" satisfies AiProviderKind,
      baseUrl: null,
      apiKey: "secret",
      dataPolicy: "paid_no_training",
      enabled: true,
    },
    capabilities: ["vision", "json", "thinking", "search"],
    enabled: true,
    pricing: {
      inputUsdMicrosPerM: 750_000,
      cachedInputUsdMicrosPerM: null,
      outputUsdMicrosPerM: 3_750_000,
      searchUsdMicros: 0,
    },
    creditMultiplierBp: 10_000,
    ...overrides,
  };
}

const retryable = (code: "rate_limited" | "unavailable" | "timeout" = "unavailable") =>
  new AiProviderError(code, code === "rate_limited" ? 429 : 503);

interface Harness {
  ports: RouterPorts;
  usage: UsageRecord[];
  notes: RouterNote[];
  redis: FakeRedis;
  calls: string[];
  alerts: number;
  kill: { all: boolean; search: boolean };
  setCap(cap: number): void;
}

function harness(
  scripts: Record<string, Script>,
  options: {
    models?: RouterModel[];
    params?: Record<string, Record<string, unknown>>;
    route?: ResolvedRoute | null;
    breaker?: "redis" | "memory";
  } = {},
): Harness {
  const redis = new FakeRedis();
  const calls: string[] = [];
  const usage: UsageRecord[] = [];
  const notes: RouterNote[] = [];
  const kill = { all: false, search: false };
  let cap = 1_000_000;
  const state = { alerts: 0 };
  const models = options.models ?? Object.keys(scripts).map((id) => model(id));
  const route: ResolvedRoute | null =
    options.route === undefined
      ? {
          routeId: "route-1",
          version: 7,
          attempts: models.map((m) => ({ model: m, params: options.params?.[m.id] ?? {} })),
        }
      : options.route;

  const ports: RouterPorts = {
    resolveRoute: () => Promise.resolve(route),
    breaker: options.breaker === "memory" ? new MemoryBreakerStore() : new RedisBreakerStore(redis),
    recordUsage: (row) => {
      usage.push(row);
      return Promise.resolve(`usage-${String(usage.length)}`);
    },
    spendGuard: createSpendGuard(redis, {
      limits: () => Promise.resolve({ dailyCapUsdMicros: cap, alertPercent: 80 }),
      onAlert: () => {
        state.alerts++;
      },
    }),
    limits: () => Promise.resolve({ dailyCapUsdMicros: cap, alertPercent: 80 }),
    killSwitch: (_task: AiTask, opts) => Promise.resolve(opts.search ? kill.search : kill.all),
    adapterFor: (m) => {
      const script = scripts[m.id];
      if (!script) throw new AiProviderError("auth");
      return adapter(script, () => void calls.push(m.id));
    },
    onNote: (note) => void notes.push(note),
  };
  return {
    ports,
    usage,
    notes,
    redis,
    calls,
    get alerts() {
      return state.alerts;
    },
    kill,
    setCap: (value) => {
      cap = value;
    },
  };
}

const input = (overrides: Partial<RouterInput> = {}): RouterInput => ({
  task: "chat",
  mode: "fast",
  planId: null,
  request: {
    messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
    maxOutputTokens: 1_000,
  },
  ownerUserId: "user-1",
  userId: "user-1",
  requestId: "req-1",
  ...overrides,
});

async function drain(
  h: Harness,
  routerInput: RouterInput = input(),
  signal: AbortSignal = new AbortController().signal,
) {
  const events: RouterEvent[] = [];
  let error: unknown;
  try {
    for await (const event of createRouter(h.ports).run(routerInput, signal)) events.push(event);
  } catch (caught) {
    error = caught;
  }
  return { events, error };
}

const resultOf = (events: RouterEvent[]) => {
  const last = events.at(-1);
  if (last?.type !== "result") throw new Error("no result event");
  return last.result;
};

describe("router: routing and fallback", () => {
  it("streams the primary, then reports the final usage, cost, model and route version", async () => {
    const h = harness({ m1: okScript, m2: okScript });
    const { events, error } = await drain(h);

    expect(error).toBeUndefined();
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
    expect(resultOf(events)).toMatchObject({
      outcome: "ok",
      modelId: "m1",
      routeVersion: 7,
      costUsdMicros: USAGE_COST,
      totalCostUsdMicros: USAGE_COST,
      usage: USAGE,
      usageId: "usage-1",
      attempts: 1,
    });
    expect(h.calls).toEqual(["m1"]);
  });

  it("falls back to the next model on a retryable error, in route order", async () => {
    const h = harness({
      m1: [retryable("rate_limited")],
      m2: [retryable("timeout")],
      m3: okScript,
    });
    const { events, error } = await drain(h);

    expect(error).toBeUndefined();
    expect(h.calls).toEqual(["m1", "m2", "m3"]);
    expect(resultOf(events)).toMatchObject({ modelId: "m3", attempts: 3 });
  });

  it("does not fall back on a non-retryable error (400 / bad request)", async () => {
    const h = harness({ m1: [new AiProviderError("bad_request", 400)], m2: okScript });
    const { error } = await drain(h);

    expect(error).toMatchObject({ code: "bad_request", retryable: false });
    expect(h.calls).toEqual(["m1"]);
    expect(h.usage.map((row) => row.outcome)).toEqual(["error"]);
  });

  it("throws the last retryable error when every model fails", async () => {
    const h = harness({ m1: [retryable()], m2: [retryable("rate_limited")] });
    const { error } = await drain(h);
    expect(error).toMatchObject({ code: "rate_limited" });
  });

  it("writes one usage row per attempt, failures included, without any content", async () => {
    const h = harness({ m1: [retryable("timeout")], m2: okScript });
    await drain(h);

    expect(h.usage).toHaveLength(2);
    expect(h.usage[0]).toMatchObject({
      modelId: "m1",
      providerId: "prov-m1",
      modelKey: "provider-m1",
      outcome: "timeout",
      costUsdMicros: 0,
      inputTokens: 0,
      routeVersion: 7,
      task: "chat",
      ownerUserId: "user-1",
      requestId: "req-1",
    });
    expect(h.usage[1]).toMatchObject({
      modelId: "m2",
      outcome: "ok",
      costUsdMicros: USAGE_COST,
      inputTokens: 1_000,
      outputTokens: 100,
    });
    const keys = Object.keys(h.usage[1] ?? {});
    expect(keys).not.toContain("prompt");
    expect(keys).not.toContain("text");
  });

  it("prefers the cost the provider itself reports", async () => {
    const h = harness({
      m1: [
        { type: "usage", usage: { ...USAGE, providerCostUsdMicros: 42 } },
        { type: "done", finishReason: "stop" },
      ],
    });
    const { events } = await drain(h);
    expect(resultOf(events).costUsdMicros).toBe(42);
  });

  it("skips disabled models, disabled providers and models lacking a required capability", async () => {
    const disabled = model("m1", { enabled: false });
    const providerOff = model("m2");
    providerOff.provider.enabled = false;
    const noJson = model("m3", { capabilities: ["vision"] });
    const good = model("m4");
    const h = harness(
      { m1: okScript, m2: okScript, m3: okScript, m4: okScript },
      { models: [disabled, providerOff, noJson, good] },
    );
    const routerInput = input();
    routerInput.request = { ...routerInput.request, jsonSchema: { type: "object" } };
    const { events } = await drain(h, routerInput);

    expect(h.calls).toEqual(["m4"]);
    expect(resultOf(events).modelId).toBe("m4");
    expect(h.notes).toEqual([
      { type: "model_skipped", modelId: "m1", reason: "model_disabled" },
      { type: "model_skipped", modelId: "m2", reason: "provider_disabled" },
      { type: "model_skipped", modelId: "m3", reason: "missing_capability" },
    ]);
  });

  it("never sends medical tasks to a free-tier provider", async () => {
    const free = model("m1");
    free.provider.dataPolicy = "free_tier";
    const h = harness({ m1: okScript, m2: okScript }, { models: [free, model("m2")] });
    await drain(h, input({ task: "rx_extract" }));
    expect(h.calls).toEqual(["m2"]);

    const again = harness({ m1: okScript }, { models: [free] });
    await drain(again, input({ task: "title_gen" }));
    expect(again.calls).toEqual(["m1"]);
  });

  it("applies the route params over the caller's request", async () => {
    const seen: unknown[] = [];
    const h = harness(
      { m1: okScript },
      { params: { m1: { thinking: "high", maxOutputTokens: 77, temperature: 0 } } },
    );
    h.ports.adapterFor = () => ({
      async *stream(req) {
        seen.push(req);
        yield* okScript;
      },
      listModels: () => Promise.resolve([]),
      testConnection: () => Promise.resolve({ ok: true, latencyMs: 0 }),
    });
    await drain(h);
    expect(seen[0]).toMatchObject({
      model: "provider-m1",
      thinking: "high",
      maxOutputTokens: 77,
      temperature: 0,
    });
  });

  it("refuses with no_route when nothing is configured, and no_model when nothing is usable", async () => {
    const none = harness({ m1: okScript }, { route: null });
    expect((await drain(none)).error).toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      details: { reason: "no_route" },
    });

    const off = harness({ m1: okScript }, { models: [model("m1", { enabled: false })] });
    expect((await drain(off)).error).toMatchObject({ details: { reason: "no_model" } });

    const unconfigured = harness({}, { models: [model("m1")] });
    expect((await drain(unconfigured)).error).toMatchObject({ details: { reason: "no_model" } });
  });
});

describe("router: circuit breaker", () => {
  it("opens after 5 retryable failures and skips the model, then closes after the TTL", async () => {
    const h = harness({ m1: [retryable()], m2: okScript });
    const router = createRouter(h.ports);
    const once = async () => {
      for await (const event of router.run(input(), new AbortController().signal)) void event;
    };

    for (let i = 0; i < 5; i++) await once();
    expect(h.calls.filter((id) => id === "m1")).toHaveLength(5);

    await once();
    expect(h.calls.filter((id) => id === "m1")).toHaveLength(5); // skipped while open
    expect(h.calls.at(-1)).toBe("m2");

    h.redis.advance(61);
    await once();
    expect(h.calls.filter((id) => id === "m1")).toHaveLength(6); // closed again
  });

  it("does not count non-retryable errors against a model", async () => {
    const h = harness({ m1: [new AiProviderError("bad_request", 400)] });
    for (let i = 0; i < 6; i++) await drain(h);
    expect(h.calls).toHaveLength(6);
  });

  it("keeps working when the breaker store is down", async () => {
    const h = harness({ m1: okScript });
    h.ports.breaker = {
      isOpen: () => Promise.reject(new Error("redis down")),
      recordFailure: () => Promise.reject(new Error("redis down")),
      recordSuccess: () => Promise.reject(new Error("redis down")),
    };
    const { error, events } = await drain(h);
    expect(error).toBeUndefined();
    expect(resultOf(events).modelId).toBe("m1");
  });
});

describe("router: kill switch and spend guard", () => {
  it("refuses with ai_paused before touching a provider when the task is switched off", async () => {
    const h = harness({ m1: okScript });
    h.kill.all = true;
    const { error } = await drain(h);

    expect(error).toMatchObject({ code: "UPSTREAM_UNAVAILABLE", details: { reason: "ai_paused" } });
    expect(h.calls).toEqual([]);
    expect(h.usage).toEqual([]);
  });

  it("skips search-enabled models while the search switch is on", async () => {
    const h = harness({ m1: okScript, m2: okScript }, { params: { m1: { search: true } } });
    h.kill.search = true;
    const { events } = await drain(h);
    expect(h.calls).toEqual(["m2"]);
    expect(resultOf(events).modelId).toBe("m2");
  });

  it("refuses with ai_paused once today's spend has reached the cap", async () => {
    const h = harness({ m1: okScript });
    h.setCap(10_000);
    await h.ports.spendGuard.add(10_000);
    const { error } = await drain(h);

    expect(error).toMatchObject({ details: { reason: "ai_paused" } });
    expect(h.calls).toEqual([]);
    expect(h.usage).toEqual([]);
  });

  it("books the estimate, then corrects spend to the real cost of all attempts", async () => {
    const h = harness({ m1: [{ type: "usage", usage: USAGE }, retryable()], m2: okScript });
    // maxOutputTokens 1_000 x 3_750_000 / 1M = 3_750 estimated on the first model.
    await drain(h);
    const day = new Date().toISOString().slice(0, 10);
    // Both attempts reported USAGE (failed attempts too), so spend is 2 x USAGE_COST.
    expect(await h.redis.get(`ai:spend:${day}`)).toBe(String(USAGE_COST * 2));
  });

  it("fires the spend alert once when a call pushes spend over the threshold", async () => {
    const h = harness({ m1: okScript });
    h.setCap(5_000); // the 3_750 estimate is 75%; the next call books another estimate and crosses 80%
    await drain(h);
    expect(h.alerts).toBe(0);
    await drain(h);
    await drain(h);
    expect(h.alerts).toBe(1);
  });
});

describe("router: cancellation", () => {
  it("ends quietly on abort, records a cancelled attempt and still reports the result", async () => {
    const controller = new AbortController();
    const h = harness({ m1: okScript });
    h.ports.adapterFor = () => ({
      async *stream() {
        yield { type: "text", text: "partial" } satisfies NormalizedEvent;
        controller.abort();
        yield { type: "usage", usage: USAGE } satisfies NormalizedEvent;
      },
      listModels: () => Promise.resolve([]),
      testConnection: () => Promise.resolve({ ok: true, latencyMs: 0 }),
    });
    const { events, error } = await drain(h, input(), controller.signal);

    expect(error).toBeUndefined();
    expect(h.usage.map((row) => row.outcome)).toEqual(["cancelled"]);
    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
  });
});

describe("router: tool calling (wa_agent)", () => {
  const TOOLS = [
    {
      name: "get_catalog",
      description: "Plans and prices",
      parameters: { type: "object", properties: {} },
    },
  ];
  const toolCallsScript: Script = [
    { type: "tool_calls", toolCalls: [{ id: "c1", name: "get_catalog", arguments: {} }] },
    { type: "usage", usage: USAGE },
    { type: "done", finishReason: "stop" },
  ];

  function capturing(script: Script, seen: NormalizedRequest[]): AIProviderAdapter {
    return {
      async *stream(req) {
        seen.push(req);
        for (const step of script) {
          if (step instanceof Error) throw step;
          yield step;
        }
      },
      listModels: () => Promise.resolve([]),
      testConnection: () => Promise.resolve({ ok: true, latencyMs: 0 }),
    };
  }

  it("accepts the wa_agent task, passes tools through and drops web search next to them", async () => {
    const h = harness({ m1: toolCallsScript }, { params: { m1: { search: true } } });
    const seen: NormalizedRequest[] = [];
    h.ports.adapterFor = () => capturing(toolCallsScript, seen);
    const { events, error } = await drain(
      h,
      input({
        task: "wa_agent",
        request: {
          messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
          maxOutputTokens: 500,
          search: true,
          tools: TOOLS,
          toolChoice: "auto",
        },
      }),
    );
    expect(error).toBeUndefined();
    expect(events.some((e) => e.type === "tool_calls")).toBe(true);
    expect(seen[0]?.tools).toEqual(TOOLS);
    expect(seen[0]?.toolChoice).toBe("auto");
    expect(seen[0]?.search).toBeUndefined();
    expect(h.usage[0]?.task).toBe("wa_agent");
  });

  it("noFallback tries only the first model, even on a retryable error", async () => {
    const h = harness({ m1: [retryable()], m2: okScript });
    const { error } = await drain(h, input({ task: "wa_agent", noFallback: true }));
    expect(error).toBeInstanceOf(AiProviderError);
    expect(h.calls).toEqual(["m1"]);
  });

  it("the wa_agent kill switch is its own group and all still covers it", () => {
    const off = { all: false, rx: false, chat: false, search: false, wa_agent: false };
    expect(isAiSwitchedOff({ ...off, wa_agent: true }, "wa_agent", { search: false })).toBe(true);
    expect(isAiSwitchedOff({ ...off, chat: true }, "wa_agent", { search: false })).toBe(false);
    expect(isAiSwitchedOff({ ...off, all: true }, "wa_agent", { search: false })).toBe(true);
    expect(isAiSwitchedOff({ ...off, wa_agent: true }, "chat", { search: false })).toBe(false);
  });
});
