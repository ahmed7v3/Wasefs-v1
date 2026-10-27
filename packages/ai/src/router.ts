import { MEDICAL_AI_TASKS } from "@wasfa/shared/ai";
import { isAppError } from "@wasfa/shared/errors";
import { routeModelParamsSchema, type RouteModelParams } from "@wasfa/shared/schemas/admin-ai";

import { costUsdMicros } from "./pricing.js";
import { aiPausedError, noModelError } from "./refusals.js";
import {
  runWithFallbacks,
  type AttemptInfo,
  type RunnerCandidate,
  type RunnerEvent,
} from "./runner.js";

import type { BreakerStore } from "./breaker.js";
import type { SpendGuard, SpendLimits } from "./spend-guard.js";
import type { AIProviderAdapter, ModelPricing, NormalizedRequest, Usage } from "./types.js";
import type {
  AiCapability,
  AiDataPolicy,
  AiMode,
  AiOutcome,
  AiProviderKind,
  AiTask,
} from "@wasfa/shared/ai";

/*
 * The router turns "task x plan x mode" into provider calls. It owns the policy (kill switch, spend
 * guard, model eligibility, breaker, accounting) and nothing else: the route lookup, the usage
 * insert, the adapter construction and the stores are ports, so this package never touches the
 * database or a Redis client and the same router serves the API and the worker.
 */

export interface RouterProvider {
  id: string;
  key: string;
  kind: AiProviderKind;
  baseUrl: string | null;
  /** Already decrypted, only ever handed to `adapterFor`. */
  apiKey: string | null;
  dataPolicy: AiDataPolicy;
  enabled: boolean;
}

export interface RouterModel {
  /** `ai_models.id`: the breaker key and what usage rows reference. */
  id: string;
  /** The provider's own model id (free text). */
  modelId: string;
  provider: RouterProvider;
  capabilities: readonly AiCapability[];
  enabled: boolean;
  pricing: ModelPricing;
  /** Basis points of the provider cost charged in credits (10000 = x1). */
  creditMultiplierBp: number;
}

export interface ResolvedRoute {
  routeId: string;
  version: number;
  /** Primary first, then the fallbacks. `params` is the route entry's JSON (validated here). */
  attempts: { model: RouterModel; params: Record<string, unknown> }[];
}

/** One `ai_usage` row. Never any content. */
export interface UsageRecord {
  task: AiTask;
  routeVersion: number;
  modelId: string;
  providerId: string;
  modelKey: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  userId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  searchCount: number;
  costUsdMicros: number;
  creditsCharged: number;
  latencyMs: number;
  outcome: AiOutcome;
  cacheHit: boolean;
  requestId: string | null;
}

export type RouterNote =
  | { type: "model_skipped"; modelId: string; reason: SkipReason }
  | { type: "usage_record_failed" }
  | { type: "store_unavailable"; store: "breaker" | "spend_guard" };

export type SkipReason =
  | "model_disabled"
  | "provider_disabled"
  | "missing_capability"
  | "free_tier_medical"
  | "search_off"
  | "adapter_unavailable";

export interface RouterPorts {
  resolveRoute(task: AiTask, planId: string | null, mode: AiMode): Promise<ResolvedRoute | null>;
  breaker: BreakerStore;
  /** Persists one usage row and returns its id. */
  recordUsage(row: UsageRecord): Promise<string>;
  spendGuard: SpendGuard;
  /** Daily cap and alert threshold (the `ai` setting). */
  limits(): Promise<SpendLimits>;
  /**
   * Whether the task is switched off. With `search: true` the question is "is search switched off
   * for this task" (the web-search switch also stops a search-enabled chat model).
   */
  killSwitch(task: AiTask, options: { search: boolean }): boolean | Promise<boolean>;
  adapterFor(model: RouterModel): AIProviderAdapter;
  /** Optional observability; must not throw and never receives content. */
  onNote?(note: RouterNote): void;
}

export interface RouterInput {
  task: AiTask;
  mode: AiMode;
  /** Null = the default plan's route. */
  planId: string | null;
  /** Everything but the model id, which comes from the route. Route params override its fields. */
  request: Omit<NormalizedRequest, "model">;
  ownerUserId?: string | null;
  ownerOrgId?: string | null;
  userId?: string | null;
  requestId?: string | null;
  /** Prompt size, for the worst-case spend estimate booked before the call. */
  estimateInputTokens?: number;
  attemptTimeoutMs?: number;
  /**
   * Try only the first eligible model. A tool loop sets it once a tool has run: the side effects
   * are done, so a different model must not take over the half-finished conversation.
   */
  noFallback?: boolean;
}

export interface RouterResult {
  outcome: "ok" | "cancelled";
  /** `ai_models.id` of the model that answered. */
  modelId: string;
  routeVersion: number;
  /** Usage of the answering attempt, when the provider reported any. */
  usage: Usage | undefined;
  /** Provider cost of the answering attempt, integer USD micros. */
  costUsdMicros: number;
  /** Provider cost of every attempt, failed ones included: what the spend guard was corrected to. */
  totalCostUsdMicros: number;
  /** `ai_usage.id` of the answering attempt (for the ledger link), when it was stored. */
  usageId: string | null;
  creditMultiplierBp: number;
  /** Attempts actually made. */
  attempts: number;
}

export type RouterEvent = RunnerEvent | { type: "result"; result: RouterResult };

export interface Router {
  /**
   * Streams the answer, then one `result` event. Refusals throw `AppError` (`UPSTREAM_UNAVAILABLE`:
   * `ai_paused`, `no_route`, `no_model`); provider failures throw `AiProviderError`. Aborting
   * ends the stream quietly (the `result` event still follows when an attempt had started).
   */
  run(input: RouterInput, signal: AbortSignal): AsyncGenerator<RouterEvent>;
}

interface Planned {
  model: RouterModel;
  params: RouteModelParams;
  request: NormalizedRequest;
}

interface Answered {
  planned: Planned;
  info: AttemptInfo;
  cost: number;
  usageId: string | null;
}

function parseParams(raw: Record<string, unknown>): RouteModelParams {
  const parsed = routeModelParamsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** The request shaped for one route entry; admin-set params win over the caller's defaults. */
function shapeRequest(
  base: Omit<NormalizedRequest, "model">,
  model: RouterModel,
  params: RouteModelParams,
): NormalizedRequest {
  const { jsonSchema, search, ...rest } = base;
  const useSchema = jsonSchema !== undefined && params.jsonSchema !== false;
  // Web search and function declarations do not mix on every provider: tools win.
  const withTools = base.tools !== undefined && base.tools.length > 0;
  const useSearch = withTools ? undefined : (params.search ?? search);
  return {
    ...rest,
    model: model.modelId,
    ...(useSchema ? { jsonSchema } : {}),
    ...(useSearch === undefined ? {} : { search: useSearch }),
    ...(params.thinking === undefined ? {} : { thinking: params.thinking }),
    ...(params.mediaResolution === undefined ? {} : { mediaResolution: params.mediaResolution }),
    ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
    maxOutputTokens: params.maxOutputTokens ?? base.maxOutputTokens,
  };
}

function requiredCapabilities(request: NormalizedRequest): AiCapability[] {
  const needs: AiCapability[] = [];
  if (
    request.messages.some(
      (message) => message.role !== "tool" && message.parts.some((part) => part.type === "image"),
    )
  ) {
    needs.push("vision");
  }
  if (request.jsonSchema !== undefined) needs.push("json");
  if (request.search === true) needs.push("search");
  return needs;
}

function outcomeOf(info: AttemptInfo): AiOutcome {
  if (info.outcome === "ok") return "ok";
  if (info.outcome === "cancelled") return "cancelled";
  return info.error?.code === "timeout" ? "timeout" : "error";
}

/** What the provider billed when it says so (OpenRouter), else our own price table. Never throws. */
function costOf(usage: Usage | undefined, pricing: ModelPricing): number {
  if (!usage) return 0;
  if (usage.providerCostUsdMicros !== undefined) return usage.providerCostUsdMicros;
  try {
    return costUsdMicros(usage, pricing);
  } catch {
    // Malformed counts from a provider: the row is still written, at zero, rather than losing the attempt.
    return 0;
  }
}

export function createRouter(ports: RouterPorts): Router {
  const note = (value: RouterNote): void => {
    ports.onNote?.(value);
  };

  /** Breaker and spend-guard trouble (Redis down) must not take the AI features down with it. */
  async function tolerate<T>(store: "breaker" | "spend_guard", fallback: T, run: () => Promise<T>) {
    try {
      return await run();
    } catch {
      note({ type: "store_unavailable", store });
      return fallback;
    }
  }

  async function plan(input: RouterInput, route: ResolvedRoute): Promise<Planned[]> {
    const searchOff = await ports.killSwitch(input.task, { search: true });
    const planned: Planned[] = [];
    for (const { model, params: rawParams } of route.attempts) {
      const skip = (reason: SkipReason): void => {
        note({ type: "model_skipped", modelId: model.id, reason });
      };
      if (!model.enabled) {
        skip("model_disabled");
        continue;
      }
      if (!model.provider.enabled) {
        skip("provider_disabled");
        continue;
      }
      // Defence in depth: the route editor refuses this too, but a provider can be re-flagged later.
      if (MEDICAL_AI_TASKS.has(input.task) && model.provider.dataPolicy === "free_tier") {
        skip("free_tier_medical");
        continue;
      }
      const params = parseParams(rawParams);
      const request = shapeRequest(input.request, model, params);
      if (request.search === true && searchOff) {
        skip("search_off");
        continue;
      }
      if (requiredCapabilities(request).some((need) => !model.capabilities.includes(need))) {
        skip("missing_capability");
        continue;
      }
      planned.push({ model, params, request });
    }
    return planned;
  }

  async function* run(input: RouterInput, signal: AbortSignal): AsyncGenerator<RouterEvent> {
    // 1. Switches and the spend cap come before anything else: a paused service touches no provider.
    if (await ports.killSwitch(input.task, { search: false })) throw aiPausedError();
    const limits = await ports.limits();
    try {
      await ports.spendGuard.check(limits.dailyCapUsdMicros);
    } catch (error) {
      if (isAppError(error)) throw error;
      note({ type: "store_unavailable", store: "spend_guard" });
    }

    const route = await ports.resolveRoute(input.task, input.planId, input.mode);
    if (!route) throw noModelError("no_route");

    // 2. Eligible models, in route order, each with its own shaped request.
    const planned = await plan(input, route);
    const candidates: RunnerCandidate[] = [];
    const byKey = new Map<string, Planned>();
    for (const item of planned) {
      let adapter: AIProviderAdapter;
      try {
        adapter = ports.adapterFor(item.model);
      } catch {
        // No key, a key that no longer decrypts, or a config the adapter refuses.
        note({ type: "model_skipped", modelId: item.model.id, reason: "adapter_unavailable" });
        continue;
      }
      candidates.push({ key: item.model.id, adapter, request: item.request });
      byKey.set(item.model.id, item);
    }
    if (input.noFallback === true) candidates.length = Math.min(candidates.length, 1);
    const first = candidates[0] ? byKey.get(candidates[0].key) : undefined;
    if (!first) throw noModelError("no_model");

    // 3. Book the worst case of the first model that will be tried; corrected when the call ends.
    const estimate = costOf(
      {
        inputTokens: input.estimateInputTokens ?? 0,
        cachedInputTokens: 0,
        outputTokens: first.request.maxOutputTokens,
        thinkingTokens: 0,
        searchCount: first.request.search === true ? 1 : 0,
      },
      first.model.pricing,
    );
    const day = await tolerate("spend_guard", undefined, () => ports.spendGuard.add(estimate));

    let totalCost = 0;
    let attempts = 0;
    const state: { answered?: Answered } = {};

    const onAttempt = async (info: AttemptInfo): Promise<void> => {
      const item = byKey.get(info.key);
      if (!item) return;
      attempts += 1;
      const cost = costOf(info.usage, item.model.pricing);
      totalCost += cost;

      // Only provider-health failures count; a 400 is the request's fault, not the model's.
      if (info.outcome === "ok") {
        await tolerate("breaker", undefined, () => ports.breaker.recordSuccess(item.model.id));
      } else if (info.outcome === "error" && info.error?.retryable === true) {
        await tolerate("breaker", undefined, () => ports.breaker.recordFailure(item.model.id));
      }

      let usageId: string | null = null;
      try {
        usageId = await ports.recordUsage({
          task: input.task,
          routeVersion: route.version,
          modelId: item.model.id,
          providerId: item.model.provider.id,
          modelKey: item.model.modelId,
          ownerUserId: input.ownerUserId ?? null,
          ownerOrgId: input.ownerOrgId ?? null,
          userId: input.userId ?? null,
          inputTokens: info.usage?.inputTokens ?? 0,
          cachedInputTokens: info.usage?.cachedInputTokens ?? 0,
          outputTokens: info.usage?.outputTokens ?? 0,
          thinkingTokens: info.usage?.thinkingTokens ?? 0,
          searchCount: info.usage?.searchCount ?? 0,
          costUsdMicros: cost,
          creditsCharged: 0,
          latencyMs: info.latencyMs,
          outcome: outcomeOf(info),
          cacheHit: false,
          requestId: input.requestId ?? null,
        });
      } catch {
        // Losing a usage row is bad but must not break the answer the user is already reading.
        note({ type: "usage_record_failed" });
      }
      if (info.outcome !== "error") state.answered = { planned: item, info, cost, usageId };
    };

    try {
      for await (const event of runWithFallbacks(
        candidates,
        signal,
        {
          isOpen: (key) => tolerate("breaker", false, () => ports.breaker.isOpen(key)),
          onAttempt,
        },
        input.attemptTimeoutMs === undefined ? {} : { attemptTimeoutMs: input.attemptTimeoutMs },
      )) {
        yield event;
      }
      const final = state.answered;
      if (final) {
        yield {
          type: "result",
          result: {
            outcome: final.info.outcome === "ok" ? "ok" : "cancelled",
            modelId: final.planned.model.id,
            routeVersion: route.version,
            usage: final.info.usage,
            costUsdMicros: final.cost,
            totalCostUsdMicros: totalCost,
            usageId: final.usageId,
            creditMultiplierBp: final.planned.model.creditMultiplierBp,
            attempts,
          },
        };
      }
    } finally {
      await tolerate("spend_guard", undefined, () =>
        ports.spendGuard.correct(totalCost - estimate, day),
      );
    }
  }

  return { run };
}
