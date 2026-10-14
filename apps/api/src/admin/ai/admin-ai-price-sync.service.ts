import { randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AiProviderError, type DiscoveredModel, type ModelPricing } from "@wasfa/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  PRICE_SYNC_TOKEN_PATTERN,
  priceSyncChangeSchema,
  type ApplyPriceSyncInput,
  type PriceSyncChange,
  type PriceSyncField,
  type PriceSyncPreview,
} from "@wasfa/shared/schemas/admin-ai";
import { Redis } from "ioredis";
import { z } from "zod";

import { REDIS } from "../../common/redis.js";

import { AdminAiModelsRepo, type ModelRow } from "./admin-ai-models.repo.js";
import { AdminAiProvidersRepo } from "./admin-ai-providers.repo.js";
import { AiGatewayFactory } from "./ai-gateway.factory.js";

import type { AuditScope } from "../../audit/audited.decorator.js";

export const PRICE_SYNC_AUDIT_FIELDS = ["models", "changes"] as const;

const LIST_TIMEOUT_MS = 20_000;
/** Decision #11: every non-queue Redis key expires. */
export const PRICE_SYNC_TTL_SECONDS = 600;
const syncKey = (token: string) => `ai:pricesync:v1:${token}`;

/** The diff is bound to the admin who previewed it: a leaked token cannot apply someone else's diff. */
const storedSchema = z.object({
  actorId: z.uuid(),
  changes: z.array(priceSyncChangeSchema),
});

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const expired = () => new AppError(ErrorCode.CONFLICT, { details: { reason: "sync_expired" } });

/** Each field with where it lives in OpenRouter's pricing and in our row. */
const FIELDS: readonly {
  field: PriceSyncField;
  before: (row: ModelRow) => number | null;
  after: (pricing: ModelPricing) => number | null;
}[] = [
  {
    field: "priceInputUsdMicrosPerM",
    before: (row) => row.model.priceInputUsdMicrosPerM,
    after: (pricing) => pricing.inputUsdMicrosPerM,
  },
  {
    field: "priceCachedInputUsdMicrosPerM",
    before: (row) => row.model.priceCachedInputUsdMicrosPerM,
    after: (pricing) => pricing.cachedInputUsdMicrosPerM,
  },
  {
    field: "priceOutputUsdMicrosPerM",
    before: (row) => row.model.priceOutputUsdMicrosPerM,
    after: (pricing) => pricing.outputUsdMicrosPerM,
  },
  {
    field: "priceSearchUsdMicros",
    before: (row) => row.model.priceSearchUsdMicros,
    after: (pricing) => pricing.searchUsdMicros,
  },
];

/**
 * "Sync prices from OpenRouter": a preview that stores its diff for ten minutes, then an apply by
 * token. OpenRouter lists most providers' models, so a Gemini model matches as `google/<id>`.
 */
@Injectable()
export class AdminAiPriceSyncService {
  constructor(
    private readonly providers: AdminAiProvidersRepo,
    private readonly models: AdminAiModelsRepo,
    private readonly gateway: AiGatewayFactory,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async preview(actorId: string): Promise<PriceSyncPreview> {
    const sources = (await this.providers.list()).filter(
      (provider) => provider.kind === "openrouter" && provider.apiKeyEnc !== null,
    );
    if (sources.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "no_price_source" } });
    }

    const listed = new Map<string, DiscoveredModel>();
    for (const source of sources) {
      try {
        const found = await this.gateway
          .adapterFor(source)
          .listModels(AbortSignal.timeout(LIST_TIMEOUT_MS));
        for (const model of found) if (!listed.has(model.id)) listed.set(model.id, model);
      } catch (error) {
        throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
          details: { reason: error instanceof AiProviderError ? error.code : "unknown" },
        });
      }
    }

    const changes: PriceSyncChange[] = [];
    let unmatched = 0;
    for (const row of await this.models.list()) {
      const match =
        listed.get(row.model.modelId) ??
        (row.provider.kind === "gemini" ? listed.get(`google/${row.model.modelId}`) : undefined);
      if (!match?.pricing) {
        unmatched += 1;
        continue;
      }
      for (const { field, before, after } of FIELDS) {
        const next = after(match.pricing);
        // An unreported price (no cached or search price) is not a price of zero: leave ours alone.
        if (next === null || next === before(row)) continue;
        changes.push({
          modelId: row.model.id,
          providerKey: row.provider.key,
          model: row.model.modelId,
          field,
          before: before(row),
          after: next,
        });
      }
    }

    const token = randomBytes(16).toString("hex");
    try {
      await this.redis.set(
        syncKey(token),
        JSON.stringify({ actorId, changes }),
        "EX",
        PRICE_SYNC_TTL_SECONDS,
      );
    } catch {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { details: { reason: "cache" } });
    }
    return { token, changes, unmatched };
  }

  async apply(
    actorId: string,
    input: ApplyPriceSyncInput,
    audit: AuditScope,
  ): Promise<{ models: number; changes: number }> {
    if (!PRICE_SYNC_TOKEN_PATTERN.test(input.token)) throw expired();
    const raw = await this.redis.get(syncKey(input.token)).catch(() => null);
    if (raw === null) throw expired();
    const stored = storedSchema.safeParse(parseJson(raw));
    if (!stored.success || stored.data.actorId !== actorId) throw expired();

    const only = input.modelIds === undefined ? undefined : new Set(input.modelIds);
    const chosen = stored.data.changes.filter(
      (change) => only === undefined || only.has(change.modelId),
    );
    const models = await this.models.applyPrices(chosen, new Date());
    // One use per preview: a second apply would write the same stale prices again.
    await this.redis.del(syncKey(input.token)).catch(() => 0);

    const result = { models, changes: chosen.length };
    audit.after = result;
    return result;
  }
}
