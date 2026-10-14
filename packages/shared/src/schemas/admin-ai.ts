import { z } from "zod";

import {
  AI_CAPABILITIES,
  AI_DATA_POLICIES,
  AI_MODES,
  AI_OUTCOMES,
  AI_PROVIDER_KINDS,
  AI_TASKS,
  PRICE_SOURCES,
} from "../ai.js";
import { aiSettingsSchema } from "../settings.js";

import { cursorQuerySchema } from "./admin.js";

/*
 * Admin AI control contract (Phase 2, Task 2.4): providers, models, price sync, routes and AI
 * settings. Money is integer USD micros (1 USD = 1,000,000), per 1M tokens unless noted. An API key
 * only ever travels inward (`apiKey`); responses carry `hasKey` and a masked `keyHint`.
 */

const isoDate = z.iso.datetime({ offset: true });

/** A provider's own model id, free text because providers rename and retire models. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
export const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

/** Far above any real price, well inside a safe integer. */
const PRICE_MAX = 1_000_000_000_000;
const price = z.number().int().min(0).max(PRICE_MAX);

export const adminAiParamSchema = z.object({ id: z.uuid() });

// --- Providers ---

const providerBaseUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      // Credentials in a URL would be stored and shown in clear.
      return url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }, "must not contain credentials");

const providerApiKey = z.string().trim().min(8).max(512);

export const createProviderSchema = z
  .object({
    key: z.string().regex(PROVIDER_KEY_PATTERN),
    kind: z.enum(AI_PROVIDER_KINDS),
    baseUrl: providerBaseUrl.nullable().default(null),
    dataPolicy: z.enum(AI_DATA_POLICIES),
    priority: z.number().int().min(0).max(100_000).default(100),
    enabled: z.boolean().default(false),
    apiKey: providerApiKey.optional(),
  })
  .refine((value) => value.kind !== "openai_compatible" || value.baseUrl !== null, {
    message: "an OpenAI-compatible provider needs a base URL",
    path: ["baseUrl"],
  });
export type CreateProviderInput = z.output<typeof createProviderSchema>;

/** The key is replaced, never edited: `apiKey` sets a new one, `clearKey` removes it. */
export const updateProviderSchema = z
  .object({
    baseUrl: providerBaseUrl.nullable(),
    dataPolicy: z.enum(AI_DATA_POLICIES),
    priority: z.number().int().min(0).max(100_000),
    enabled: z.boolean(),
    apiKey: providerApiKey,
    clearKey: z.literal(true),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field")
  .refine((value) => value.apiKey === undefined || value.clearKey === undefined, {
    message: "apiKey and clearKey are mutually exclusive",
    path: ["clearKey"],
  });
export type UpdateProviderInput = z.output<typeof updateProviderSchema>;

export const providerViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  kind: z.enum(AI_PROVIDER_KINDS),
  baseUrl: z.string().nullable(),
  enabled: z.boolean(),
  priority: z.number().int(),
  dataPolicy: z.enum(AI_DATA_POLICIES),
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  lastTestAt: isoDate.nullable(),
  lastTestOk: z.boolean().nullable(),
  lastTestError: z.string().nullable(),
  modelCount: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ProviderView = z.output<typeof providerViewSchema>;

export const providerListResponseSchema = z.object({ items: z.array(providerViewSchema) });

export const providerTestResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().int().min(0),
  errorCode: z.string().nullable(),
  testedAt: isoDate,
});
export type ProviderTestResult = z.output<typeof providerTestResultSchema>;

export const discoverQuerySchema = z.object({
  /** `?refresh=1` bypasses the 10-minute cache. */
  refresh: z
    .enum(["1", "true"])
    .optional()
    .transform((value) => value !== undefined),
});

export const discoveredModelSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  contextTokens: z.number().int().nullable(),
  capabilities: z.array(z.enum(AI_CAPABILITIES)),
  pricing: z
    .object({
      inputUsdMicrosPerM: z.number().int(),
      cachedInputUsdMicrosPerM: z.number().int().nullable(),
      outputUsdMicrosPerM: z.number().int(),
      searchUsdMicros: z.number().int().nullable(),
    })
    .nullable(),
  alreadyAdded: z.boolean(),
});
export type DiscoveredModelView = z.output<typeof discoveredModelSchema>;

export const discoverResponseSchema = z.object({
  items: z.array(discoveredModelSchema),
  fetchedAt: isoDate,
  cached: z.boolean(),
});
export type DiscoverResponse = z.output<typeof discoverResponseSchema>;

// --- Models ---

export const MODEL_WARNINGS = ["unpriced", "price_stale", "preview", "provider_disabled"] as const;
export type ModelWarning = (typeof MODEL_WARNINGS)[number];

const modelDisplayName = z.string().trim().min(1).max(120);
const modelCapabilities = z
  .array(z.enum(AI_CAPABILITIES))
  .max(AI_CAPABILITIES.length)
  .refine((items) => new Set(items).size === items.length, "capabilities must be unique");
const contextTokens = z.number().int().min(1).max(100_000_000);
const creditMultiplierBp = z.number().int().min(1).max(1_000_000);

/**
 * Prices have no defaults on purpose: any price present in a request stamps `price_checked_at`, so
 * the service must know which ones the admin actually sent.
 */
export const createModelSchema = z.object({
  providerId: z.uuid(),
  modelId: z.string().trim().regex(MODEL_ID_PATTERN),
  displayName: modelDisplayName,
  capabilities: modelCapabilities.default([]),
  contextTokens: contextTokens.nullable().optional(),
  priceInputUsdMicrosPerM: price,
  priceCachedInputUsdMicrosPerM: price.nullable().optional(),
  priceOutputUsdMicrosPerM: price,
  priceSearchUsdMicros: price.nullable().optional(),
  creditMultiplierBp: creditMultiplierBp.default(10_000),
  enabled: z.boolean().default(true),
  priceSource: z.enum(PRICE_SOURCES).default("manual"),
});
export type CreateModelInput = z.output<typeof createModelSchema>;

/** `providerId` and `modelId` are the model's identity: they never change. */
export const updateModelSchema = z
  .object({
    displayName: modelDisplayName,
    capabilities: modelCapabilities,
    contextTokens: contextTokens.nullable(),
    priceInputUsdMicrosPerM: price,
    priceCachedInputUsdMicrosPerM: price.nullable(),
    priceOutputUsdMicrosPerM: price,
    priceSearchUsdMicros: price.nullable(),
    creditMultiplierBp,
    enabled: z.boolean(),
    priceSource: z.enum(PRICE_SOURCES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field");
export type UpdateModelInput = z.output<typeof updateModelSchema>;

export const modelsQuerySchema = z.object({ providerId: z.uuid().optional() });

export const modelViewSchema = z.object({
  id: z.uuid(),
  provider: z.object({ id: z.uuid(), key: z.string(), kind: z.enum(AI_PROVIDER_KINDS) }),
  modelId: z.string(),
  displayName: z.string(),
  capabilities: z.array(z.enum(AI_CAPABILITIES)),
  contextTokens: z.number().int().nullable(),
  priceInputUsdMicrosPerM: z.number().int(),
  priceCachedInputUsdMicrosPerM: z.number().int().nullable(),
  priceOutputUsdMicrosPerM: z.number().int(),
  priceSearchUsdMicros: z.number().int(),
  creditMultiplierBp: z.number().int(),
  enabled: z.boolean(),
  priceSource: z.enum(PRICE_SOURCES),
  priceCheckedAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  warnings: z.array(z.enum(MODEL_WARNINGS)),
  usedInRoutes: z.number().int(),
});
export type ModelView = z.output<typeof modelViewSchema>;

export const modelListResponseSchema = z.object({ items: z.array(modelViewSchema) });

// --- OpenRouter price sync ---

export const PRICE_SYNC_FIELDS = [
  "priceInputUsdMicrosPerM",
  "priceCachedInputUsdMicrosPerM",
  "priceOutputUsdMicrosPerM",
  "priceSearchUsdMicros",
] as const;
export type PriceSyncField = (typeof PRICE_SYNC_FIELDS)[number];

export const priceSyncChangeSchema = z.object({
  /** Our `ai_models.id`. */
  modelId: z.uuid(),
  providerKey: z.string(),
  /** The provider's own model id. */
  model: z.string(),
  field: z.enum(PRICE_SYNC_FIELDS),
  before: z.number().int().nullable(),
  /** Never null: a price OpenRouter does not report is left alone. */
  after: z.number().int(),
});
export type PriceSyncChange = z.output<typeof priceSyncChangeSchema>;

export const PRICE_SYNC_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export const priceSyncPreviewSchema = z.object({
  token: z.string().regex(PRICE_SYNC_TOKEN_PATTERN),
  changes: z.array(priceSyncChangeSchema),
  unmatched: z.number().int().min(0),
});
export type PriceSyncPreview = z.output<typeof priceSyncPreviewSchema>;

export const applyPriceSyncSchema = z.object({
  token: z.string().regex(PRICE_SYNC_TOKEN_PATTERN),
  /** A subset of the previewed models; omitted = all of them. */
  modelIds: z.array(z.uuid()).max(500).optional(),
});
export type ApplyPriceSyncInput = z.output<typeof applyPriceSyncSchema>;

export const priceSyncApplyResultSchema = z.object({
  /** Models that changed, and price fields written across them. */
  models: z.number().int().min(0),
  changes: z.number().int().min(0),
});

// --- Routes ---

export const ROUTE_MAX_MODELS = 6;

export const routeModelParamsSchema = z
  .object({
    thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional(),
    mediaResolution: z.enum(["low", "medium", "high", "ultra_high"]).optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.int().min(1).max(65_536).optional(),
    search: z.boolean().optional(),
    jsonSchema: z.boolean().optional(),
  })
  .strict();
export type RouteModelParams = z.output<typeof routeModelParamsSchema>;

/** Index 0 is the primary, the rest are the fallbacks in order. `modelId` is `ai_models.id`. */
export const routeModelsSchema = z
  .array(z.object({ modelId: z.uuid(), params: routeModelParamsSchema }))
  .min(1)
  .max(ROUTE_MAX_MODELS)
  .refine(
    (items) => new Set(items.map((item) => item.modelId)).size === items.length,
    "a model can appear once per route",
  );
export type RouteModels = z.output<typeof routeModelsSchema>;

export const putRouteSchema = z.object({
  task: z.enum(AI_TASKS),
  /** Null = the default route for every plan without its own. */
  planId: z.uuid().nullable(),
  mode: z.enum(AI_MODES),
  models: routeModelsSchema,
  /** The version the editor loaded; a different stored version means someone else saved first. */
  expectedVersion: z.number().int().min(1).optional(),
  /**
   * Why a primary model with a lower accuracy-eval score than the current one is promoted (Task 2.10).
   * Optional here; the service requires it when the eval scores say so, and audits it.
   */
  reason: z.string().trim().min(10).max(500).optional(),
});
export type PutRouteInput = z.output<typeof putRouteSchema>;

export const ROUTE_WARNING_REASONS = [
  "model_missing",
  "model_disabled",
  "provider_disabled",
] as const;
export type RouteWarningReason = (typeof ROUTE_WARNING_REASONS)[number];

export const routeWarningSchema = z.object({
  reason: z.enum(ROUTE_WARNING_REASONS),
  /** Position in the route's model list. */
  index: z.number().int().min(0),
});

export const routeModelViewSchema = z.object({
  modelId: z.uuid(),
  params: routeModelParamsSchema,
  /** Null when the model row no longer exists. */
  model: z
    .object({
      modelId: z.string(),
      displayName: z.string(),
      providerKey: z.string(),
      enabled: z.boolean(),
      capabilities: z.array(z.enum(AI_CAPABILITIES)),
      priceInput: z.number().int(),
      priceOutput: z.number().int(),
    })
    .nullable(),
});

export const routeViewSchema = z.object({
  id: z.uuid(),
  task: z.enum(AI_TASKS),
  planId: z.uuid().nullable(),
  planKey: z.string().nullable(),
  mode: z.enum(AI_MODES),
  version: z.number().int().min(1),
  models: z.array(routeModelViewSchema),
  warnings: z.array(routeWarningSchema),
  /** Last finished accuracy-eval score (0-100) of the primary model; only `rx_extract` routes have one. */
  lastEvalScore: z.number().min(0).max(100).nullable().optional(),
  updatedAt: isoDate,
});
export type RouteView = z.output<typeof routeViewSchema>;

export const routeListResponseSchema = z.object({
  items: z.array(routeViewSchema),
  /** Task x mode for the default routes, so the grid can show what is missing. */
  matrix: z.array(
    z.object({
      task: z.enum(AI_TASKS),
      mode: z.enum(AI_MODES),
      routeId: z.uuid().nullable(),
    }),
  ),
});

// --- Settings ---

/**
 * Every field is required in a write: a partial body must not silently reset the spend cap or a
 * kill switch to its default. The stored shape stays `aiSettingsSchema`.
 */
export const putAiSettingsSchema = z.object({
  dailyCapUsdMicros: aiSettingsSchema.shape.dailyCapUsdMicros.unwrap(),
  alertPercent: aiSettingsSchema.shape.alertPercent.unwrap(),
  killSwitch: z.object({
    all: z.boolean(),
    rx: z.boolean(),
    chat: z.boolean(),
    search: z.boolean(),
  }),
  creditValueUsdMicros: aiSettingsSchema.shape.creditValueUsdMicros.unwrap(),
  allowPreviewModels: aiSettingsSchema.shape.allowPreviewModels.unwrap(),
});
export type PutAiSettingsInput = z.output<typeof putAiSettingsSchema>;

export const aiSettingsResponseSchema = z.object({
  value: aiSettingsSchema,
  updatedAt: isoDate.nullable(),
});
export type AiSettingsResponse = z.output<typeof aiSettingsResponseSchema>;

// --- Overview (spend, volume and quality; SQL aggregates only, never content) ---

export const AI_OVERVIEW_DAYS = [7, 30] as const;
export type AiOverviewDays = (typeof AI_OVERVIEW_DAYS)[number];

export const aiOverviewQuerySchema = z.object({
  days: z
    .enum(["7", "30"])
    .default("7")
    .transform((value): AiOverviewDays => (value === "30" ? 30 : 7)),
});

const ratio = z.number().min(0).max(1);

export const aiOverviewSchema = z.object({
  days: z.union([z.literal(7), z.literal(30)]),
  generatedAt: isoDate,
  /** Today's provider spend against the cap. `redis` is the spend guard's live figure. */
  today: z.object({
    day: z.string(),
    spendUsdMicros: z.number().int().min(0),
    capUsdMicros: z.number().int().min(0),
    alertPercent: z.number().int(),
    source: z.enum(["redis", "database"]),
  }),
  totals: z.object({
    calls: z.number().int().min(0),
    costUsdMicros: z.number().int().min(0),
    /** error + timeout rows / all rows. */
    errorRate: ratio,
    /** Requests whose first attempt failed and a later one answered / requests answered. */
    fallbackRate: ratio,
    /** cache_hit rows / all rows. */
    cacheHitRate: ratio,
    latencyP50Ms: z.number().int().min(0).nullable(),
    latencyP95Ms: z.number().int().min(0).nullable(),
  }),
  /** Provider cost of one prescription analysis (rx_extract + rx_verify of one request id). */
  perAnalysis: z.object({
    analyses: z.number().int().min(0),
    avgUsdMicros: z.number().int().min(0).nullable(),
    p95UsdMicros: z.number().int().min(0).nullable(),
  }),
  byDay: z.array(
    z.object({
      day: z.string(),
      calls: z.number().int().min(0),
      costUsdMicros: z.number().int().min(0),
    }),
  ),
  byTask: z.array(
    z.object({
      task: z.enum(AI_TASKS),
      calls: z.number().int().min(0),
      costUsdMicros: z.number().int().min(0),
    }),
  ),
  byModel: z.array(
    z.object({
      modelKey: z.string(),
      calls: z.number().int().min(0),
      costUsdMicros: z.number().int().min(0),
    }),
  ),
});
export type AiOverview = z.output<typeof aiOverviewSchema>;

// --- Usage explorer ---

const usageDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

/** Filters shared by the list, the totals and the CSV export. */
export const aiUsageFilterSchema = z.object({
  /** The acting user or the owner. */
  userId: z.uuid().optional(),
  orgId: z.uuid().optional(),
  task: z.enum(AI_TASKS).optional(),
  /** The provider's own model id (`ai_usage.model_key`), exact. */
  model: z.string().trim().min(1).max(200).optional(),
  outcome: z.enum(AI_OUTCOMES).optional(),
  /** A date means the whole UTC day (`to` included). */
  from: usageDate.optional(),
  to: usageDate.optional(),
});
export type AiUsageFilter = z.output<typeof aiUsageFilterSchema>;

export const aiUsageListQuerySchema = cursorQuerySchema.extend(aiUsageFilterSchema.shape);

export const aiUsageRowSchema = z.object({
  id: z.uuid(),
  createdAt: isoDate,
  task: z.enum(AI_TASKS),
  modelKey: z.string(),
  providerKey: z.string().nullable(),
  ownerUserId: z.uuid().nullable(),
  ownerOrgId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
  inputTokens: z.number().int(),
  cachedInputTokens: z.number().int(),
  outputTokens: z.number().int(),
  thinkingTokens: z.number().int(),
  searchCount: z.number().int(),
  costUsdMicros: z.number().int(),
  creditsCharged: z.number().int(),
  latencyMs: z.number().int().nullable(),
  outcome: z.enum(AI_OUTCOMES),
  cacheHit: z.boolean(),
  requestId: z.string().nullable(),
});
export type AiUsageRow = z.output<typeof aiUsageRowSchema>;

export const aiUsagePageSchema = z.object({
  items: z.array(aiUsageRowSchema),
  nextCursor: z.string().nullable(),
});

export const aiUsageTotalsSchema = z.object({
  calls: z.number().int().min(0),
  costUsdMicros: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  thinkingTokens: z.number().int().min(0),
  creditsCharged: z.number().int().min(0),
  errors: z.number().int().min(0),
  cacheHits: z.number().int().min(0),
  avgLatencyMs: z.number().int().min(0).nullable(),
});
export type AiUsageTotals = z.output<typeof aiUsageTotalsSchema>;

// --- Playground ---

export const PLAYGROUND_MAX_MODELS = 3;
export const PLAYGROUND_MAX_FILES = 4;
export const PLAYGROUND_MAX_INPUT_CHARS = 8_000;
/** Runs per admin per hour; each run is one provider call per selected model. */
export const PLAYGROUND_RATE_LIMIT = { max: 20, windowSeconds: 3_600 } as const;

export const playgroundRequestSchema = z
  .object({
    task: z.enum(AI_TASKS),
    input: z.string().max(PLAYGROUND_MAX_INPUT_CHARS).default(""),
    /** The admin's own processed `chat_image` files. */
    fileIds: z.array(z.uuid()).max(PLAYGROUND_MAX_FILES).default([]),
    /** `ai_models.id`, one run each, side by side. */
    modelIds: z
      .array(z.uuid())
      .min(1)
      .max(PLAYGROUND_MAX_MODELS)
      .refine((items) => new Set(items).size === items.length, "a model can be picked once"),
  })
  .refine((value) => value.input.trim() !== "" || value.fileIds.length > 0, {
    message: "an input or a picture is required",
    path: ["input"],
  });
export type PlaygroundRequest = z.output<typeof playgroundRequestSchema>;

export const playgroundRunSchema = z.object({
  modelId: z.uuid(),
  modelKey: z.string(),
  providerKey: z.string(),
  /** `refused`: the router would not start (kill switch, spend cap, no eligible model). */
  status: z.enum(["ok", "error", "refused"]),
  /** A short code of ours (`ai_paused`, `timeout`, ...), never a provider message. */
  errorCode: z.string().nullable(),
  output: z.string(),
  usage: z
    .object({
      inputTokens: z.number().int(),
      cachedInputTokens: z.number().int(),
      outputTokens: z.number().int(),
      thinkingTokens: z.number().int(),
      searchCount: z.number().int(),
    })
    .nullable(),
  costUsdMicros: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  /** `schema` is set for JSON tasks (`rx_extract`, `rx_verify`); `errors` are `path: code` lines. */
  validation: z.object({
    schema: z.enum(["rx_extract", "rx_verify"]).nullable(),
    ok: z.boolean().nullable(),
    errors: z.array(z.string().max(200)).max(20),
  }),
});
export type PlaygroundRun = z.output<typeof playgroundRunSchema>;

export const playgroundResponseSchema = z.object({ runs: z.array(playgroundRunSchema) });
export type PlaygroundResponse = z.output<typeof playgroundResponseSchema>;

// --- Skills ---

export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]{0,59}$/;
export const skillParamSchema = z.object({ name: z.string().regex(SKILL_NAME_PATTERN) });

export const skillViewSchema = z.object({
  name: z.string(),
  description: z.string(),
  tasks: z.array(z.enum(AI_TASKS)),
  /** `<name>@<12 hex of the file hash>`, what analyses and the cache key record. */
  version: z.string(),
  hash: z.string(),
  /** `all`, or the plan keys it is on for (`[]` = off everywhere). */
  enabledFor: z.union([z.literal("all"), z.array(z.string())]),
  /** Whether the chat can start with this skill (the prescription skill is analysed via `/rx`). */
  chat: z.boolean(),
});
export type SkillView = z.output<typeof skillViewSchema>;

export const skillsResponseSchema = z.object({
  items: z.array(skillViewSchema),
  plans: z.array(z.object({ key: z.string(), nameAr: z.string(), nameEn: z.string() })),
});
export type SkillsResponse = z.output<typeof skillsResponseSchema>;

export const putSkillSchema = z.object({
  enabledFor: z.union([
    z.literal("all"),
    z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(100),
  ]),
});
export type PutSkillInput = z.output<typeof putSkillSchema>;
