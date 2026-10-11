import { z } from "zod";

import {
  AI_CAPABILITIES,
  AI_DATA_POLICIES,
  AI_MODES,
  AI_PROVIDER_KINDS,
  AI_TASKS,
  PRICE_SOURCES,
} from "../ai.js";
import { aiSettingsSchema } from "../settings.js";

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
