import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { SettingsService } from "../../settings/settings.service.js";

import { AdminAiModelsRepo, type ModelPatch, type ModelRow } from "./admin-ai-models.repo.js";
import { AdminAiProvidersRepo } from "./admin-ai-providers.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AiModel } from "@wasfa/db";
import type {
  CreateModelInput,
  ModelView,
  ModelWarning,
  UpdateModelInput,
} from "@wasfa/shared/schemas/admin-ai";

/** Fields kept in the audit rows of model changes. No ids: the audit redactor mangles digit runs. */
export const MODEL_AUDIT_FIELDS = [
  "providerKey",
  "modelId",
  "displayName",
  "capabilities",
  "contextTokens",
  "priceInputUsdMicrosPerM",
  "priceCachedInputUsdMicrosPerM",
  "priceOutputUsdMicrosPerM",
  "priceSearchUsdMicros",
  "creditMultiplierBp",
  "enabled",
  "priceSource",
] as const;

/** A price older than this is shown with a warning: providers change prices without notice. */
export const PRICE_STALE_DAYS = 30;
const DAY_MS = 86_400_000;

const conflict = (reason: string, extra: Record<string, number> = {}) =>
  new AppError(ErrorCode.CONFLICT, { details: { reason, ...extra } });

const modelFields = (model: AiModel, providerKey: string) => ({
  providerKey,
  modelId: model.modelId,
  displayName: model.displayName,
  capabilities: model.capabilities,
  contextTokens: model.contextTokens,
  priceInputUsdMicrosPerM: model.priceInputUsdMicrosPerM,
  priceCachedInputUsdMicrosPerM: model.priceCachedInputUsdMicrosPerM,
  priceOutputUsdMicrosPerM: model.priceOutputUsdMicrosPerM,
  priceSearchUsdMicros: model.priceSearchUsdMicros,
  creditMultiplierBp: model.creditMultiplierBp,
  enabled: model.enabled,
  priceSource: model.priceSource,
});

/** Preview models can vanish without notice: they are refused in routes unless an admin allows them. */
export const isPreviewModel = (modelId: string): boolean =>
  modelId.toLowerCase().includes("preview");

function warningsOf(row: ModelRow, allowPreview: boolean, now: number): ModelWarning[] {
  const { model, provider } = row;
  const warnings: ModelWarning[] = [];
  if (model.priceInputUsdMicrosPerM === 0 && model.priceOutputUsdMicrosPerM === 0) {
    warnings.push("unpriced");
  }
  if (
    model.priceCheckedAt === null ||
    now - model.priceCheckedAt.getTime() > PRICE_STALE_DAYS * DAY_MS
  ) {
    warnings.push("price_stale");
  }
  if (!allowPreview && isPreviewModel(model.modelId)) warnings.push("preview");
  if (!provider.enabled) warnings.push("provider_disabled");
  return warnings;
}

function modelView(row: ModelRow, allowPreview: boolean, now: number): ModelView {
  const { model, provider } = row;
  return {
    id: model.id,
    provider: { id: provider.id, key: provider.key, kind: provider.kind },
    modelId: model.modelId,
    displayName: model.displayName,
    capabilities: model.capabilities,
    contextTokens: model.contextTokens,
    priceInputUsdMicrosPerM: model.priceInputUsdMicrosPerM,
    priceCachedInputUsdMicrosPerM: model.priceCachedInputUsdMicrosPerM,
    priceOutputUsdMicrosPerM: model.priceOutputUsdMicrosPerM,
    priceSearchUsdMicros: model.priceSearchUsdMicros,
    creditMultiplierBp: model.creditMultiplierBp,
    enabled: model.enabled,
    priceSource: model.priceSource,
    priceCheckedAt: model.priceCheckedAt?.toISOString() ?? null,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
    warnings: warningsOf(row, allowPreview, now),
    usedInRoutes: row.usedInRoutes,
  };
}

/** Model catalogue: free-text ids, prices and the credit multiplier. */
@Injectable()
export class AdminAiModelsService {
  constructor(
    private readonly repo: AdminAiModelsRepo,
    private readonly providersRepo: AdminAiProvidersRepo,
    private readonly settings: SettingsService,
  ) {}

  async list(providerId: string | undefined): Promise<{ items: ModelView[] }> {
    const [rows, ai] = await Promise.all([this.repo.list(providerId), this.settings.get("ai")]);
    const now = Date.now();
    return { items: rows.map((row) => modelView(row, ai.allowPreviewModels, now)) };
  }

  async create(input: CreateModelInput, audit: AuditScope): Promise<ModelView> {
    const provider = await this.providersRepo.find(input.providerId);
    if (!provider) throw new AppError(ErrorCode.NOT_FOUND);
    const created = await this.repo.create({
      providerId: provider.id,
      modelId: input.modelId,
      displayName: input.displayName,
      capabilities: input.capabilities,
      contextTokens: input.contextTokens ?? null,
      priceInputUsdMicrosPerM: input.priceInputUsdMicrosPerM,
      priceCachedInputUsdMicrosPerM: input.priceCachedInputUsdMicrosPerM ?? null,
      priceOutputUsdMicrosPerM: input.priceOutputUsdMicrosPerM,
      priceSearchUsdMicros: input.priceSearchUsdMicros ?? 0,
      creditMultiplierBp: input.creditMultiplierBp,
      enabled: input.enabled,
      priceSource: input.priceSource,
      // Prices are always given on create, so they were checked by the admin just now.
      priceCheckedAt: new Date(),
    });
    if (!created) throw conflict("model_exists");
    audit.targetId = created.id;
    audit.after = modelFields(created, provider.key);
    return this.view(created.id);
  }

  async update(id: string, input: UpdateModelInput, audit: AuditScope): Promise<ModelView> {
    const current = await this.repo.find(id);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);

    const pricesChanged =
      input.priceInputUsdMicrosPerM !== undefined ||
      input.priceCachedInputUsdMicrosPerM !== undefined ||
      input.priceOutputUsdMicrosPerM !== undefined ||
      input.priceSearchUsdMicros !== undefined;
    const patch: ModelPatch = {
      displayName: input.displayName,
      capabilities: input.capabilities,
      contextTokens: input.contextTokens,
      priceInputUsdMicrosPerM: input.priceInputUsdMicrosPerM,
      priceCachedInputUsdMicrosPerM: input.priceCachedInputUsdMicrosPerM,
      priceOutputUsdMicrosPerM: input.priceOutputUsdMicrosPerM,
      // The column is NOT NULL: "no search price" is 0.
      priceSearchUsdMicros: input.priceSearchUsdMicros === null ? 0 : input.priceSearchUsdMicros,
      creditMultiplierBp: input.creditMultiplierBp,
      enabled: input.enabled,
      // A hand-typed price is a manual one, whatever set the previous value.
      priceSource: input.priceSource ?? (pricesChanged ? "manual" : undefined),
      priceCheckedAt: pricesChanged ? new Date() : undefined,
    };
    const outcome = await this.repo.update(id, patch);
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind === "is_primary")
      throw conflict("model_is_primary", { routes: outcome.routes });
    audit.targetId = id;
    audit.before = modelFields(outcome.before, current.provider.key);
    audit.after = modelFields(outcome.after, current.provider.key);
    return this.view(id);
  }

  async remove(id: string, audit: AuditScope): Promise<void> {
    const current = await this.repo.find(id);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);
    const outcome = await this.repo.remove(id);
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind === "in_use") throw conflict("model_in_use");
    audit.targetId = id;
    audit.before = modelFields(outcome.model, current.provider.key);
  }

  private async view(id: string): Promise<ModelView> {
    const [row, ai] = await Promise.all([this.repo.find(id), this.settings.get("ai")]);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return modelView(row, ai.allowPreviewModels, Date.now());
  }
}
