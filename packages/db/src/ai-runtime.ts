import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { aiModels, aiProviders, aiTaskRoutes, aiUsage } from "./schema/index.js";

import type { Database } from "./client.js";
import type { NewAiUsage } from "./schema/index.js";
import type {
  AiCapability,
  AiDataPolicy,
  AiMode,
  AiOutcome,
  AiProviderKind,
  AiTask,
} from "@wasfa/shared/ai";

/*
 * The database half of the AI router's ports (`@wasfa/ai` never imports this package; the shapes
 * below match its `RouterPorts` structurally and the wiring in the API/worker type-checks that).
 * Queries only: decrypting a provider key needs `ENCRYPTION_KEY`, which the caller owns, so it
 * arrives as a function. Nothing here ever stores a prompt or an answer.
 */

export interface RuntimeProvider {
  id: string;
  key: string;
  kind: AiProviderKind;
  baseUrl: string | null;
  /** Decrypted; null when the provider has no key or the stored one no longer decrypts. */
  apiKey: string | null;
  dataPolicy: AiDataPolicy;
  enabled: boolean;
}

export interface RuntimeModel {
  id: string;
  modelId: string;
  provider: RuntimeProvider;
  capabilities: readonly AiCapability[];
  enabled: boolean;
  pricing: {
    inputUsdMicrosPerM: number;
    cachedInputUsdMicrosPerM: number | null;
    outputUsdMicrosPerM: number;
    searchUsdMicros: number;
  };
  creditMultiplierBp: number;
}

export interface RuntimeRoute {
  routeId: string;
  version: number;
  attempts: { model: RuntimeModel; params: Record<string, unknown> }[];
}

/** Turns a stored `api_key_enc` into the key. May throw (wrong `ENCRYPTION_KEY`); the caller then has no key. */
export type DecryptProviderKey = (providerKey: string, apiKeyEnc: string) => string;

interface ModelRow {
  model: typeof aiModels.$inferSelect;
  provider: typeof aiProviders.$inferSelect;
}

function toRuntimeModel(row: ModelRow, decrypt: DecryptProviderKey): RuntimeModel {
  let apiKey: string | null = null;
  if (row.provider.apiKeyEnc !== null) {
    try {
      apiKey = decrypt(row.provider.key, row.provider.apiKeyEnc);
    } catch {
      apiKey = null;
    }
  }
  return {
    id: row.model.id,
    modelId: row.model.modelId,
    capabilities: row.model.capabilities,
    enabled: row.model.enabled,
    creditMultiplierBp: row.model.creditMultiplierBp,
    pricing: {
      inputUsdMicrosPerM: row.model.priceInputUsdMicrosPerM,
      cachedInputUsdMicrosPerM: row.model.priceCachedInputUsdMicrosPerM,
      outputUsdMicrosPerM: row.model.priceOutputUsdMicrosPerM,
      searchUsdMicros: row.model.priceSearchUsdMicros,
    },
    provider: {
      id: row.provider.id,
      key: row.provider.key,
      kind: row.provider.kind,
      baseUrl: row.provider.baseUrl,
      apiKey,
      dataPolicy: row.provider.dataPolicy,
      enabled: row.provider.enabled,
    },
  };
}

/**
 * The route for a task, plan and mode: the plan's own route when it has one, else the default
 * route (`plan_id` null). Entries whose model row no longer exists are dropped; disabled models
 * are kept (the router skips them and says why).
 */
export async function resolveAiRoute(
  db: Database,
  decrypt: DecryptProviderKey,
  task: AiTask,
  planId: string | null,
  mode: AiMode,
): Promise<RuntimeRoute | null> {
  const rows = await db
    .select()
    .from(aiTaskRoutes)
    .where(
      and(
        eq(aiTaskRoutes.task, task),
        eq(aiTaskRoutes.mode, mode),
        planId === null
          ? isNull(aiTaskRoutes.planId)
          : or(eq(aiTaskRoutes.planId, planId), isNull(aiTaskRoutes.planId)),
      ),
    );
  const route = rows.find((row) => row.planId !== null) ?? rows.find((row) => row.planId === null);
  if (!route) return null;

  const ids = route.models.map((entry) => entry.modelId);
  const found =
    ids.length === 0
      ? []
      : await db
          .select({ model: aiModels, provider: aiProviders })
          .from(aiModels)
          .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
          .where(inArray(aiModels.id, ids));
  const byId = new Map(found.map((row) => [row.model.id, row]));

  const attempts: RuntimeRoute["attempts"] = [];
  for (const entry of route.models) {
    const row = byId.get(entry.modelId);
    if (!row) continue;
    attempts.push({ params: entry.params, model: toRuntimeModel(row, decrypt) });
  }
  return { routeId: route.id, version: route.version, attempts };
}

/**
 * Models by `ai_models.id`, in the order asked, with the decrypted provider key; missing ids are
 * dropped. For callers that name the models themselves (accuracy evaluation runs a frozen list).
 */
export async function loadAiModels(
  db: Database,
  decrypt: DecryptProviderKey,
  ids: readonly string[],
): Promise<RuntimeModel[]> {
  if (ids.length === 0) return [];
  const found = await db
    .select({ model: aiModels, provider: aiProviders })
    .from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(inArray(aiModels.id, [...ids]));
  const byId = new Map(found.map((row) => [row.model.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [toRuntimeModel(row, decrypt)];
  });
}

export interface RuntimeUsageRow {
  task: AiTask;
  routeVersion: number | null;
  modelId: string | null;
  providerId: string | null;
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
  latencyMs: number | null;
  outcome: AiOutcome;
  cacheHit: boolean;
  requestId: string | null;
}

/** Appends one `ai_usage` row (one provider call) and returns its id. */
export async function recordAiUsage(db: Database, row: RuntimeUsageRow): Promise<string> {
  const values: NewAiUsage = { ...row };
  const [stored] = await db.insert(aiUsage).values(values).returning({ id: aiUsage.id });
  if (!stored) throw new Error("Usage row was not stored");
  return stored.id;
}

/** The two database-backed router ports, bound to one connection and one key decryptor. */
export function createAiRuntimePorts(db: Database, decrypt: DecryptProviderKey) {
  return {
    resolveRoute: (task: AiTask, planId: string | null, mode: AiMode) =>
      resolveAiRoute(db, decrypt, task, planId, mode),
    recordUsage: (row: RuntimeUsageRow) => recordAiUsage(db, row),
  };
}
