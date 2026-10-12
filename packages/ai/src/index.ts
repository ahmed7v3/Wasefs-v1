import { FakeAdapter } from "./adapters/fake.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { OpenAiCompatibleAdapter } from "./adapters/openai-compatible.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { AiProviderError } from "./types.js";

import type { AIProviderAdapter, ProviderConfig } from "./types.js";

export * from "./types.js";
export { costUsdMicros, creditsFor, usdPerTokenToMicrosPerM, usdToMicros } from "./pricing.js";
export { runWithFallbacks } from "./runner.js";
export {
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_OPEN_SECONDS,
  BREAKER_WINDOW_SECONDS,
  MemoryBreakerStore,
  type BreakerStore,
} from "./breaker.js";
export { RedisBreakerStore } from "./breaker-redis.js";
export type { BreakerRedis, RedisLike, SpendRedis } from "./redis-like.js";
export { aiPausedError, noModelError } from "./refusals.js";
export {
  createSpendGuard,
  spendAlertedKey,
  spendKey,
  utcDay,
  type SpendAlert,
  type SpendGuard,
  type SpendGuardOptions,
  type SpendLimits,
} from "./spend-guard.js";
export { createRouter } from "./router.js";
export type {
  ResolvedRoute,
  Router,
  RouterEvent,
  RouterInput,
  RouterModel,
  RouterNote,
  RouterPorts,
  RouterProvider,
  RouterResult,
  SkipReason,
  UsageRecord,
} from "./router.js";
export type {
  AttemptInfo,
  RunnerCandidate,
  RunnerEvent,
  RunnerHooks,
  RunnerOptions,
} from "./runner.js";

export interface AdapterDeps {
  /** Injected in tests; defaults to the global fetch. Not used by Gemini (the SDK owns its transport). */
  fetch?: typeof fetch;
  /** Overrides NODE_ENV, for tests. */
  env?: string;
}

export function createAdapter(config: ProviderConfig, deps: AdapterDeps = {}): AIProviderAdapter {
  if (config.kind === "fake") {
    // The fake streams canned text; it must never be selectable for real users.
    if ((deps.env ?? process.env.NODE_ENV) === "production")
      throw new AiProviderError("bad_request");
    return new FakeAdapter();
  }

  if (!config.apiKey) throw new AiProviderError("auth");
  // Late-bound so a fetch patched after construction (msw, instrumentation) is still honoured.
  const fetchFn: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));

  switch (config.kind) {
    case "gemini":
      return new GeminiAdapter({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    case "openrouter":
      return new OpenRouterAdapter(
        { baseUrl: config.baseUrl, apiKey: config.apiKey, dataPolicy: config.dataPolicy },
        fetchFn,
      );
    case "openai_compatible":
      if (!config.baseUrl) throw new AiProviderError("bad_request");
      return new OpenAiCompatibleAdapter(
        { baseUrl: config.baseUrl, apiKey: config.apiKey },
        fetchFn,
      );
  }
}
