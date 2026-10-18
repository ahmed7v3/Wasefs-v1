import {
  AI_MODES,
  AI_TASKS,
  type AiCapability,
  type AiDataPolicy,
  type AiProviderKind,
  type AiTask,
} from "@wasfa/shared/ai";
import { eq, inArray } from "drizzle-orm";

import {
  aiModels,
  aiProviders,
  aiTaskRoutes,
  planEntitlements,
  plans,
  type NewPlanEntitlement,
  type RouteModelEntry,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { PlanAudience, PlanVisibility } from "@wasfa/shared/plans";

/*
 * Seed data of the AI product (Phase 2, Task 2.1). The paid plans (plus, pro, clinic) are seeded with
 * their prices in seed-billing.ts (Phase 3). Same policy as the rest of the seed: insert-only
 * and idempotent. Existing plans, providers, models and routes are never touched; a plan's
 * entitlements are seeded only in the same transaction that creates the plan, so an admin who
 * edits or removes one never sees it come back. Providers are seeded DISABLED with no key: nothing
 * can call a provider until an admin enables one and stores its key.
 */

interface PlanSeed {
  key: string;
  nameAr: string;
  nameEn: string;
  audience: PlanAudience;
  isDefault: boolean;
  monthlyCredits: number;
  visibility: PlanVisibility;
  sort: number;
  entitlements: readonly Omit<NewPlanEntitlement, "planId">[];
}

export const PLAN_SEEDS: readonly PlanSeed[] = [
  {
    key: "free",
    nameAr: "المجانية",
    nameEn: "Free",
    audience: "any",
    isDefault: true,
    monthlyCredits: 30,
    visibility: "public",
    sort: 10,
    entitlements: [
      {
        task: "rx_extract",
        allowed: true,
        modes: ["fast", "balanced"],
        dailyCap: 3,
        maxPagesPerRx: 4,
        webSearch: false,
      },
      { task: "chat", allowed: true, modes: ["fast", "balanced"], webSearch: false },
      // Internal steps of the two features above; their cost is covered by the feature's price.
      ...(["rx_verify", "title_gen", "classify", "summarize"] as const).map(
        (task): Omit<NewPlanEntitlement, "planId"> => ({
          task,
          allowed: true,
          modes: ["fast", "balanced"],
          webSearch: false,
        }),
      ),
    ],
  },
];

interface ProviderSeed {
  key: string;
  kind: AiProviderKind;
  dataPolicy: AiDataPolicy;
  priority: number;
}

export const PROVIDER_SEEDS: readonly ProviderSeed[] = [
  { key: "gemini", kind: "gemini", dataPolicy: "paid_no_training", priority: 10 },
  { key: "openrouter", kind: "openrouter", dataPolicy: "zdr", priority: 20 },
];

interface ModelSeed {
  provider: string;
  modelId: string;
  displayName: string;
  capabilities: readonly AiCapability[];
  /** USD micros per 1M tokens (1 USD = 1,000,000). 0 = not priced yet: an admin fills it in. */
  priceInput: number;
  priceCachedInput: number | null;
  priceOutput: number;
  enabled: boolean;
  /** Set only for prices taken from the Google pricing page on 2026-10-09 (phase2.md, Decision 3). */
  priceChecked: boolean;
}

const PRICE_CHECKED_AT = new Date("2026-10-09T00:00:00Z");

export const MODEL_SEEDS: readonly ModelSeed[] = [
  {
    provider: "gemini",
    modelId: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    capabilities: ["vision", "thinking", "search", "json", "bbox"],
    priceInput: 750_000,
    priceCachedInput: 75_000,
    priceOutput: 3_750_000,
    enabled: true,
    priceChecked: true,
  },
  {
    provider: "gemini",
    modelId: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    capabilities: ["vision", "thinking", "search", "json"],
    priceInput: 0,
    priceCachedInput: null,
    priceOutput: 0,
    enabled: true,
    priceChecked: false,
  },
  {
    provider: "gemini",
    modelId: "gemini-3.1-flash-lite",
    displayName: "Gemini 3.1 Flash-Lite",
    capabilities: ["vision", "thinking", "json"],
    priceInput: 250_000,
    priceCachedInput: null,
    priceOutput: 1_500_000,
    enabled: true,
    priceChecked: true,
  },
  {
    provider: "gemini",
    modelId: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    capabilities: ["vision", "thinking", "json"],
    priceInput: 0,
    priceCachedInput: null,
    priceOutput: 0,
    enabled: true,
    priceChecked: false,
  },
  {
    // A preview model can disappear without notice, so it is off until an admin turns it on.
    provider: "gemini",
    modelId: "gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro (preview)",
    capabilities: ["vision", "thinking", "search", "json", "bbox"],
    priceInput: 2_000_000,
    priceCachedInput: null,
    priceOutput: 12_000_000,
    enabled: false,
    priceChecked: true,
  },
  {
    provider: "openrouter",
    modelId: "google/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash (OpenRouter)",
    capabilities: ["vision", "thinking", "search", "json"],
    priceInput: 0,
    priceCachedInput: null,
    priceOutput: 0,
    enabled: true,
    priceChecked: false,
  },
];

/** A route entry before the model's database id is known: `provider/modelId` names it. */
interface RouteEntrySeed {
  provider: string;
  modelId: string;
  params: Record<string, unknown>;
}

const G = "gemini";
const O = "openrouter";
const FLASH = "gemini-3.8-flash";
const FLASH_36 = "gemini-3.6-flash";
const LITE = "gemini-3.1-flash-lite";
const LITE_35 = "gemini-3.5-flash-lite";
const PRO = "gemini-3.1-pro-preview";
const FLASH_OR = "google/gemini-3.8-flash";

/*
 * Default routes (phase2.md, Decision 3), one per task; every mode starts with the same list and an
 * admin tunes them per mode and per plan. `params` are provider-neutral hints that the adapter
 * maps to the provider's own fields; the keys are exactly `routeModelParamsSchema`'s (shared).
 */
const EXTRACT_PARAMS = {
  thinking: "low",
  mediaResolution: "high",
  temperature: 0,
  jsonSchema: true,
};

export const DEFAULT_ROUTE_SEEDS: Readonly<Record<AiTask, readonly RouteEntrySeed[]>> = {
  rx_extract: [
    { provider: G, modelId: FLASH, params: EXTRACT_PARAMS },
    { provider: O, modelId: FLASH_OR, params: EXTRACT_PARAMS },
    { provider: G, modelId: FLASH_36, params: EXTRACT_PARAMS },
  ],
  rx_verify: [
    {
      provider: G,
      modelId: FLASH,
      params: { thinking: "high", mediaResolution: "ultra_high", jsonSchema: true },
    },
    {
      provider: G,
      modelId: PRO,
      params: { thinking: "high", mediaResolution: "ultra_high", jsonSchema: true },
    },
  ],
  chat: [
    { provider: G, modelId: FLASH, params: { thinking: "low" } },
    { provider: G, modelId: FLASH_36, params: { thinking: "low" } },
  ],
  deep_think: [
    { provider: G, modelId: FLASH, params: { thinking: "high" } },
    { provider: G, modelId: PRO, params: { thinking: "high" } },
  ],
  title_gen: [
    { provider: G, modelId: LITE, params: { thinking: "minimal" } },
    { provider: G, modelId: LITE_35, params: { thinking: "minimal" } },
  ],
  classify: [
    { provider: G, modelId: LITE, params: { thinking: "minimal" } },
    { provider: G, modelId: LITE_35, params: { thinking: "minimal" } },
  ],
  summarize: [
    { provider: G, modelId: LITE, params: { thinking: "minimal" } },
    { provider: G, modelId: LITE_35, params: { thinking: "minimal" } },
  ],
  web_search: [
    { provider: G, modelId: FLASH, params: { search: true } },
    { provider: O, modelId: FLASH_OR, params: { search: true } },
  ],
};

export interface AiSeedResult {
  plans: number;
  planEntitlements: number;
  aiProviders: number;
  aiModels: number;
  aiTaskRoutes: number;
}

/**
 * Idempotent and insert-only (see the note at the top). Runs in one transaction. A route entry's
 * `modelId` is the `ai_models.id` of the model (not the provider's own model string, which is not
 * unique across providers).
 */
export async function seedAiProduct(db: Database): Promise<AiSeedResult> {
  return db.transaction(async (tx) => {
    // No conflict target on purpose: besides the key, `plans_one_default_idx` can also reject a
    // re-created default plan when an admin has made another plan the default.
    const createdPlans = await tx
      .insert(plans)
      .values(
        PLAN_SEEDS.map((plan) => ({
          key: plan.key,
          nameAr: plan.nameAr,
          nameEn: plan.nameEn,
          audience: plan.audience,
          isDefault: plan.isDefault,
          monthlyCredits: plan.monthlyCredits,
          visibility: plan.visibility,
          sort: plan.sort,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: plans.id, key: plans.key });

    const entitlements = createdPlans.flatMap((created) =>
      (PLAN_SEEDS.find((plan) => plan.key === created.key)?.entitlements ?? []).map((row) => ({
        ...row,
        planId: created.id,
      })),
    );
    if (entitlements.length > 0) {
      await tx.insert(planEntitlements).values(entitlements);
    }

    const createdProviders = await tx
      .insert(aiProviders)
      .values(PROVIDER_SEEDS.map((provider) => ({ ...provider, enabled: false })))
      .onConflictDoNothing({ target: aiProviders.key })
      .returning({ id: aiProviders.id });

    const providerRows = await tx
      .select({ id: aiProviders.id, key: aiProviders.key })
      .from(aiProviders)
      .where(
        inArray(
          aiProviders.key,
          PROVIDER_SEEDS.map((provider) => provider.key),
        ),
      );
    const providerIds = new Map(providerRows.map((row) => [row.key, row.id]));

    const modelValues = MODEL_SEEDS.flatMap((model) => {
      const providerId = providerIds.get(model.provider);
      if (providerId === undefined) return [];
      return [
        {
          providerId,
          modelId: model.modelId,
          displayName: model.displayName,
          capabilities: [...model.capabilities],
          priceInputUsdMicrosPerM: model.priceInput,
          priceCachedInputUsdMicrosPerM: model.priceCachedInput,
          priceOutputUsdMicrosPerM: model.priceOutput,
          enabled: model.enabled,
          priceSource: "manual" as const,
          priceCheckedAt: model.priceChecked ? PRICE_CHECKED_AT : null,
        },
      ];
    });
    const createdModels = await tx
      .insert(aiModels)
      .values(modelValues)
      .onConflictDoNothing({ target: [aiModels.providerId, aiModels.modelId] })
      .returning({ id: aiModels.id });

    const modelRows = await tx
      .select({ id: aiModels.id, providerKey: aiProviders.key, modelId: aiModels.modelId })
      .from(aiModels)
      .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
      .where(inArray(aiProviders.key, [...providerIds.keys()]));
    const modelIds = new Map(modelRows.map((row) => [`${row.providerKey}/${row.modelId}`, row.id]));

    const routeValues = AI_TASKS.flatMap((task) => {
      const models: RouteModelEntry[] = DEFAULT_ROUTE_SEEDS[task].flatMap((entry) => {
        const id = modelIds.get(`${entry.provider}/${entry.modelId}`);
        return id === undefined ? [] : [{ modelId: id, params: entry.params }];
      });
      if (models.length === 0) return [];
      return AI_MODES.map((mode) => ({ task, planId: null, mode, models }));
    });
    // No target: the unique index is on an expression (null plan = one value).
    const createdRoutes =
      routeValues.length === 0
        ? []
        : await tx
            .insert(aiTaskRoutes)
            .values(routeValues)
            .onConflictDoNothing()
            .returning({ id: aiTaskRoutes.id });

    return {
      plans: createdPlans.length,
      planEntitlements: entitlements.length,
      aiProviders: createdProviders.length,
      aiModels: createdModels.length,
      aiTaskRoutes: createdRoutes.length,
    };
  });
}
