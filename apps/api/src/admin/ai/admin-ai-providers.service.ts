import { Inject, Injectable } from "@nestjs/common";
import { AiProviderError, type DiscoveredModel } from "@wasfa/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  discoveredModelSchema,
  type CreateProviderInput,
  type DiscoverResponse,
  type ProviderTestResult,
  type ProviderView,
  type UpdateProviderInput,
} from "@wasfa/shared/schemas/admin-ai";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { z } from "zod";

import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";

import { AdminAiModelsRepo } from "./admin-ai-models.repo.js";
import {
  AdminAiProvidersRepo,
  type ProviderPatch,
  type ProviderRow,
} from "./admin-ai-providers.repo.js";
import { AiGatewayFactory } from "./ai-gateway.factory.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { ApiEnv } from "../../config/env.js";
import type { AiProvider } from "@wasfa/db";

/**
 * Fields kept in the audit rows of provider changes. The key itself is never among them (nor is
 * `api_key_enc`): only whether one is stored and its masked hint.
 */
export const PROVIDER_AUDIT_FIELDS = [
  "key",
  "kind",
  "baseUrl",
  "enabled",
  "priority",
  "dataPolicy",
  "hasKey",
  "keyHint",
] as const;
export const PROVIDER_TEST_AUDIT_FIELDS = ["ok", "errorCode", "latencyMs"] as const;

const TEST_TIMEOUT_MS = 10_000;
const DISCOVER_TIMEOUT_MS = 20_000;
/** Decision #11: every non-queue Redis key expires. */
export const DISCOVER_CACHE_SECONDS = 600;
const discoverKey = (providerId: string) => `ai:discover:v1:${providerId}`;

const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });
const invalid = (reason: string, field: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason, fields: [field] } });

const cachedSchema = z.object({
  fetchedAt: z.iso.datetime({ offset: true }),
  items: z.array(discoveredModelSchema.omit({ alreadyAdded: true })),
});

const providerFields = (provider: AiProvider) => ({
  key: provider.key,
  kind: provider.kind,
  baseUrl: provider.baseUrl,
  enabled: provider.enabled,
  priority: provider.priority,
  dataPolicy: provider.dataPolicy,
  hasKey: provider.apiKeyEnc !== null,
  keyHint: provider.keyHint,
});

const providerView = (row: ProviderRow): ProviderView => ({
  id: row.id,
  key: row.key,
  kind: row.kind,
  baseUrl: row.baseUrl,
  enabled: row.enabled,
  priority: row.priority,
  dataPolicy: row.dataPolicy,
  hasKey: row.apiKeyEnc !== null,
  keyHint: row.keyHint,
  lastTestAt: row.lastTestAt?.toISOString() ?? null,
  lastTestOk: row.lastTestOk,
  lastTestError: row.lastTestError,
  modelCount: row.modelCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const errorCodeOf = (error: unknown): string =>
  error instanceof AiProviderError ? error.code : "unknown";

/** Provider list, key handling, connection test and live model discovery. */
@Injectable()
export class AdminAiProvidersService {
  constructor(
    private readonly repo: AdminAiProvidersRepo,
    private readonly modelsRepo: AdminAiModelsRepo,
    private readonly gateway: AiGatewayFactory,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("AdminAiProviders");
  }

  async list(): Promise<{ items: ProviderView[] }> {
    return { items: (await this.repo.list()).map(providerView) };
  }

  async create(input: CreateProviderInput, audit: AuditScope): Promise<ProviderView> {
    if (input.kind === "fake" && this.production) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "fake_in_production" } });
    }
    this.checkBaseUrl(input.baseUrl);
    if (input.enabled && input.kind !== "fake" && input.apiKey === undefined) {
      throw invalid("missing_key", "apiKey");
    }
    const sealed =
      input.apiKey === undefined ? undefined : this.gateway.seal(input.key, input.apiKey);
    const created = await this.repo.create({
      key: input.key,
      kind: input.kind,
      baseUrl: input.baseUrl,
      dataPolicy: input.dataPolicy,
      priority: input.priority,
      enabled: input.enabled,
      ...(sealed ?? {}),
    });
    if (!created) throw conflict("key_taken");
    audit.targetId = created.id;
    audit.after = providerFields(created);
    return providerView({ ...created, modelCount: 0 });
  }

  async update(id: string, input: UpdateProviderInput, audit: AuditScope): Promise<ProviderView> {
    const current = await this.repo.find(id);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);

    if (input.enabled === true && current.kind === "fake" && this.production) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "fake_in_production" } });
    }
    if (input.baseUrl !== undefined) {
      this.checkBaseUrl(input.baseUrl);
      if (input.baseUrl === null && current.kind === "openai_compatible") {
        throw invalid("missing_base_url", "baseUrl");
      }
    }
    const hasKeyAfter =
      input.clearKey === true
        ? false
        : input.apiKey !== undefined
          ? true
          : current.apiKeyEnc !== null;
    if ((input.enabled ?? current.enabled) && current.kind !== "fake" && !hasKeyAfter) {
      throw invalid("missing_key", input.clearKey === true ? "clearKey" : "enabled");
    }

    const patch: ProviderPatch = {
      baseUrl: input.baseUrl,
      dataPolicy: input.dataPolicy,
      priority: input.priority,
      enabled: input.enabled,
      ...(input.apiKey === undefined ? {} : this.gateway.seal(current.key, input.apiKey)),
      ...(input.clearKey === true ? { apiKeyEnc: null, keyHint: null } : {}),
    };

    const updated = await this.repo.update(id, patch);
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND);
    // A new key or URL can change what the provider offers.
    await this.dropDiscoverCache(id);
    audit.targetId = id;
    audit.before = providerFields(current);
    audit.after = providerFields(updated);
    return this.view(id);
  }

  async remove(id: string, audit: AuditScope): Promise<void> {
    const outcome = await this.repo.remove(id);
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind === "in_use") throw conflict("provider_in_use");
    await this.dropDiscoverCache(id);
    audit.targetId = id;
    audit.before = providerFields(outcome.provider);
  }

  /**
   * Makes the cheapest call the adapter offers and records the answer. Works for a disabled
   * provider (that is how an admin checks one before enabling it). Only the error CODE is stored.
   */
  async test(id: string, audit: AuditScope): Promise<ProviderTestResult> {
    const provider = await this.repo.find(id);
    if (!provider) throw new AppError(ErrorCode.NOT_FOUND);

    const { ok, errorCode, latencyMs } = await this.probe(provider);

    const testedAt = new Date();
    await this.repo.recordTest(id, { at: testedAt, ok, error: errorCode });
    audit.targetId = id;
    audit.after = { ok, errorCode, latencyMs };
    return { ok, latencyMs, errorCode, testedAt: testedAt.toISOString() };
  }

  private async probe(
    provider: AiProvider,
  ): Promise<{ ok: boolean; errorCode: string | null; latencyMs: number }> {
    if (provider.apiKeyEnc === null && provider.kind !== "fake") {
      // Nothing to authenticate with: do not call out.
      return { ok: false, errorCode: "auth", latencyMs: 0 };
    }
    const startedAt = Date.now();
    try {
      const result = await this.gateway
        .adapterFor(provider)
        .testConnection(AbortSignal.timeout(TEST_TIMEOUT_MS));
      return {
        ok: result.ok,
        errorCode: result.ok ? null : (result.errorCode ?? "unknown"),
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      return { ok: false, errorCode: errorCodeOf(error), latencyMs: Date.now() - startedAt };
    }
  }

  /** The provider's live model list (cached 10 minutes), each marked when we already have it. */
  async discover(id: string, refresh: boolean): Promise<DiscoverResponse> {
    const provider = await this.repo.find(id);
    if (!provider) throw new AppError(ErrorCode.NOT_FOUND);

    let cached = refresh ? undefined : await this.readDiscoverCache(id);
    const isCached = cached !== undefined;
    if (cached === undefined) {
      let models: DiscoveredModel[];
      try {
        models = await this.gateway
          .adapterFor(provider)
          .listModels(AbortSignal.timeout(DISCOVER_TIMEOUT_MS));
      } catch (error) {
        throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, {
          details: { reason: errorCodeOf(error) },
        });
      }
      cached = {
        fetchedAt: new Date().toISOString(),
        items: models.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          contextTokens: model.contextTokens,
          capabilities: model.capabilities,
          pricing: model.pricing,
        })),
      };
      await this.writeDiscoverCache(id, cached);
    }

    const have = new Set((await this.modelsRepo.list(id)).map((row) => row.model.modelId));
    return {
      items: cached.items.map((item) => ({ ...item, alreadyAdded: have.has(item.id) })),
      fetchedAt: cached.fetchedAt,
      cached: isCached,
    };
  }

  private get production(): boolean {
    return this.env.NODE_ENV === "production";
  }

  /** A plain-http provider URL would send the key in clear: only outside production. */
  private checkBaseUrl(baseUrl: string | null): void {
    if (baseUrl !== null && this.production && !baseUrl.startsWith("https://")) {
      throw invalid("insecure_base_url", "baseUrl");
    }
  }

  private async view(id: string): Promise<ProviderView> {
    const row = await this.repo.findWithCount(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return providerView(row);
  }

  private async readDiscoverCache(id: string): Promise<z.output<typeof cachedSchema> | undefined> {
    try {
      const raw = await this.redis.get(discoverKey(id));
      if (raw === null) return undefined;
      const parsed = cachedSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch (error) {
      this.cacheUnavailable(error);
      return undefined;
    }
  }

  private async writeDiscoverCache(
    id: string,
    value: z.output<typeof cachedSchema>,
  ): Promise<void> {
    try {
      await this.redis.set(discoverKey(id), JSON.stringify(value), "EX", DISCOVER_CACHE_SECONDS);
    } catch (error) {
      this.cacheUnavailable(error);
    }
  }

  private async dropDiscoverCache(id: string): Promise<void> {
    try {
      await this.redis.del(discoverKey(id));
    } catch (error) {
      this.cacheUnavailable(error);
    }
  }

  private cacheUnavailable(error: unknown): void {
    this.logger.warn({ reason: (error as Error).message }, "AI discovery cache unavailable");
  }
}
