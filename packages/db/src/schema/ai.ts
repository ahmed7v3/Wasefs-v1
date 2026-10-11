import {
  AI_CAPABILITIES,
  AI_DATA_POLICIES,
  AI_MODES,
  AI_OUTCOMES,
  AI_PROVIDER_KINDS,
  AI_TASKS,
  PRICE_SOURCES,
} from "@wasfa/shared/ai";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { arrayWithin, idColumn, inList, timestamps } from "./columns.js";
import { optionalOwnerCheck, ownerColumns } from "./owner.js";
import { plans } from "./plans.js";
import { users } from "./users.js";

/*
 * AI control plane. Providers, models, prices and routes are data edited from the admin panel, so
 * a model can be swapped without a deploy. USD amounts are bigint USD micros (1 USD = 1,000,000),
 * never numeric or float. Model ids are free text because providers rename and retire models.
 */

export const aiProviders = pgTable(
  "ai_providers",
  {
    id: idColumn(),
    key: text().notNull().unique("ai_providers_key_key"),
    kind: text({ enum: AI_PROVIDER_KINDS }).notNull(),
    baseUrl: text(),
    // `encryptSecret` output; the key never leaves the API. `keyHint` is the last 4 characters.
    apiKeyEnc: text(),
    keyHint: text(),
    // Seeded disabled with no key: nothing calls a provider until an admin turns it on.
    enabled: boolean().notNull().default(false),
    priority: integer().notNull().default(100),
    dataPolicy: text({ enum: AI_DATA_POLICIES }).notNull(),
    lastTestAt: timestamp({ withTimezone: true }),
    lastTestOk: boolean(),
    lastTestError: text(),
    ...timestamps(),
  },
  (table) => [
    check("ai_providers_kind_check", inList(table.kind, AI_PROVIDER_KINDS)),
    check("ai_providers_data_policy_check", inList(table.dataPolicy, AI_DATA_POLICIES)),
  ],
);

export const aiModels = pgTable(
  "ai_models",
  {
    id: idColumn(),
    // RESTRICT: removing a provider with models (and so usage history) must be deliberate.
    providerId: uuid()
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    modelId: text().notNull(),
    displayName: text().notNull(),
    capabilities: text({ enum: AI_CAPABILITIES }).array().notNull().default([]),
    contextTokens: integer(),
    // USD micros per 1M tokens. Cached input is null when the model has no cached-input price.
    priceInputUsdMicrosPerM: bigint({ mode: "number" }).notNull().default(0),
    priceCachedInputUsdMicrosPerM: bigint({ mode: "number" }),
    priceOutputUsdMicrosPerM: bigint({ mode: "number" }).notNull().default(0),
    // USD micros per search call.
    priceSearchUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    // Basis points of the provider cost charged in credits: 10000 = x1.
    creditMultiplierBp: integer().notNull().default(10000),
    enabled: boolean().notNull().default(true),
    priceSource: text({ enum: PRICE_SOURCES }).notNull().default("manual"),
    priceCheckedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("ai_models_provider_model_key").on(table.providerId, table.modelId),
    check("ai_models_capabilities_check", arrayWithin(table.capabilities, AI_CAPABILITIES)),
    check("ai_models_price_input_check", sql`${table.priceInputUsdMicrosPerM} >= 0`),
    check(
      "ai_models_price_cached_input_check",
      sql`${table.priceCachedInputUsdMicrosPerM} is null or ${table.priceCachedInputUsdMicrosPerM} >= 0`,
    ),
    check("ai_models_price_output_check", sql`${table.priceOutputUsdMicrosPerM} >= 0`),
    check("ai_models_price_search_check", sql`${table.priceSearchUsdMicros} >= 0`),
    check("ai_models_credit_multiplier_check", sql`${table.creditMultiplierBp} > 0`),
    check("ai_models_price_source_check", inList(table.priceSource, PRICE_SOURCES)),
  ],
);

/** One entry of `ai_task_routes.models`. The shared zod schema is the validator; the DB checks only the shape of the array. */
export interface RouteModelEntry {
  modelId: string;
  params: Record<string, unknown>;
}

/*
 * task x plan x mode -> ordered model list (first = primary, the rest are fallbacks). `plan_id` null
 * is the default route; uniqueness treats null as one value through the nil-uuid coalesce. `version`
 * is bumped by the service on every write and stored on each usage row.
 */
export const aiTaskRoutes = pgTable(
  "ai_task_routes",
  {
    id: idColumn(),
    task: text({ enum: AI_TASKS }).notNull(),
    planId: uuid().references(() => plans.id, { onDelete: "cascade" }),
    mode: text({ enum: AI_MODES }).notNull(),
    models: jsonb().$type<RouteModelEntry[]>().notNull(),
    version: integer().notNull().default(1),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("ai_task_routes_key").on(
      table.task,
      sql`coalesce(${table.planId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.mode,
    ),
    check("ai_task_routes_task_check", inList(table.task, AI_TASKS)),
    check("ai_task_routes_mode_check", inList(table.mode, AI_MODES)),
    check(
      "ai_task_routes_models_check",
      sql`jsonb_typeof(${table.models}) = 'array' and jsonb_array_length(${table.models}) > 0`,
    ),
    check("ai_task_routes_version_check", sql`${table.version} >= 1`),
  ],
);

/*
 * One row per provider call. NO content columns: never a prompt or an answer. Both owner columns
 * may be null for system calls (a provider test, an eval run). Model and provider are `SET NULL`
 * so history survives a removed model; `model_key` is the text snapshot that keeps it readable.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: idColumn(),
    task: text({ enum: AI_TASKS }).notNull(),
    routeVersion: integer(),
    modelId: uuid().references(() => aiModels.id, { onDelete: "set null" }),
    providerId: uuid().references(() => aiProviders.id, { onDelete: "set null" }),
    modelKey: text().notNull(),
    ...ownerColumns(),
    // The acting user, never the owner.
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    inputTokens: integer().notNull().default(0),
    cachedInputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    thinkingTokens: integer().notNull().default(0),
    searchCount: integer().notNull().default(0),
    costUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    creditsCharged: integer().notNull().default(0),
    latencyMs: integer(),
    outcome: text({ enum: AI_OUTCOMES }).notNull(),
    cacheHit: boolean().notNull().default(false),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    optionalOwnerCheck("ai_usage", table),
    check("ai_usage_task_check", inList(table.task, AI_TASKS)),
    check("ai_usage_outcome_check", inList(table.outcome, AI_OUTCOMES)),
    check(
      "ai_usage_tokens_check",
      sql`${table.inputTokens} >= 0 and ${table.cachedInputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.thinkingTokens} >= 0`,
    ),
    check("ai_usage_search_count_check", sql`${table.searchCount} >= 0`),
    check("ai_usage_cost_check", sql`${table.costUsdMicros} >= 0`),
    check("ai_usage_credits_check", sql`${table.creditsCharged} >= 0`),
    check("ai_usage_latency_check", sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`),
    index("ai_usage_created_at_idx").on(table.createdAt),
    index("ai_usage_owner_user_created_idx").on(table.ownerUserId, table.createdAt),
    index("ai_usage_owner_org_created_idx").on(table.ownerOrgId, table.createdAt),
  ],
);

/** Day x provider x model aggregate kept by the worker (upsert), so `ai_usage` can be pruned after 13 months. */
export const aiSpendDaily = pgTable(
  "ai_spend_daily",
  {
    day: date({ mode: "string" }).notNull(),
    // RESTRICT: both are part of the primary key, so they cannot be nulled; spend history is kept.
    providerId: uuid()
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    modelId: uuid()
      .notNull()
      .references(() => aiModels.id, { onDelete: "restrict" }),
    calls: integer().notNull().default(0),
    inputTokens: bigint({ mode: "number" }).notNull().default(0),
    cachedInputTokens: bigint({ mode: "number" }).notNull().default(0),
    outputTokens: bigint({ mode: "number" }).notNull().default(0),
    thinkingTokens: bigint({ mode: "number" }).notNull().default(0),
    costUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.day, table.providerId, table.modelId],
      name: "ai_spend_daily_pkey",
    }),
    check(
      "ai_spend_daily_counts_check",
      sql`${table.calls} >= 0 and ${table.inputTokens} >= 0 and ${table.cachedInputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.thinkingTokens} >= 0 and ${table.costUsdMicros} >= 0`,
    ),
  ],
);

export type AiProvider = typeof aiProviders.$inferSelect;
export type NewAiProvider = typeof aiProviders.$inferInsert;
export type AiModel = typeof aiModels.$inferSelect;
export type NewAiModel = typeof aiModels.$inferInsert;
export type AiTaskRoute = typeof aiTaskRoutes.$inferSelect;
export type NewAiTaskRoute = typeof aiTaskRoutes.$inferInsert;
export type AiUsage = typeof aiUsage.$inferSelect;
export type NewAiUsage = typeof aiUsage.$inferInsert;
export type AiSpendDaily = typeof aiSpendDaily.$inferSelect;
export type NewAiSpendDaily = typeof aiSpendDaily.$inferInsert;
