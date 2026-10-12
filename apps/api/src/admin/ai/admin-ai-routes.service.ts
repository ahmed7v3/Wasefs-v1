import { Injectable } from "@nestjs/common";
import {
  AI_MODES,
  AI_TASKS,
  MEDICAL_AI_TASKS,
  type AiCapability,
  type AiTask,
} from "@wasfa/shared/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  routeModelParamsSchema,
  type PutRouteInput,
  type RouteView,
  type RouteWarningReason,
} from "@wasfa/shared/schemas/admin-ai";

import { SettingsService } from "../../settings/settings.service.js";

import { AdminAiModelsRepo, type ModelRow } from "./admin-ai-models.repo.js";
import { isPreviewModel } from "./admin-ai-models.service.js";
import { AdminAiRoutesRepo, type RouteRow } from "./admin-ai-routes.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AiTaskRoute } from "@wasfa/db";

/** Fields kept in the audit rows of route changes. Model names, not ids: the redactor mangles digit runs. */
export const ROUTE_AUDIT_FIELDS = ["task", "mode", "planKey", "version", "models"] as const;

const REQUIRED_CAPABILITIES: Partial<Record<AiTask, readonly AiCapability[]>> = {
  rx_extract: ["vision", "json"],
  rx_verify: ["vision", "json"],
  web_search: ["search"],
};

const refuse = (reason: string, index: number) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { reason, index, fields: ["models"] } });
const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });

const orderOf = <T extends string>(all: readonly T[], value: T) => all.indexOf(value);

function routeView(row: RouteRow, models: ReadonlyMap<string, ModelRow>): RouteView {
  const warnings: { reason: RouteWarningReason; index: number }[] = [];
  const entries = row.route.models.map((entry, index) => {
    const found = models.get(entry.modelId);
    if (!found) warnings.push({ reason: "model_missing", index });
    else {
      if (!found.model.enabled) warnings.push({ reason: "model_disabled", index });
      if (!found.provider.enabled) warnings.push({ reason: "provider_disabled", index });
    }
    // Params are written through `routeModelParamsSchema`; a row from before that vocabulary is shown bare.
    const params = routeModelParamsSchema.safeParse(entry.params);
    return {
      modelId: entry.modelId,
      params: params.success ? params.data : {},
      model: found
        ? {
            modelId: found.model.modelId,
            displayName: found.model.displayName,
            providerKey: found.provider.key,
            enabled: found.model.enabled,
            capabilities: found.model.capabilities,
            priceInput: found.model.priceInputUsdMicrosPerM,
            priceOutput: found.model.priceOutputUsdMicrosPerM,
          }
        : null,
    };
  });
  return {
    id: row.route.id,
    task: row.route.task,
    planId: row.route.planId,
    planKey: row.planKey,
    mode: row.route.mode,
    version: row.route.version,
    models: entries,
    warnings,
    updatedAt: row.route.updatedAt.toISOString(),
  };
}

const modelIdsOf = (route: AiTaskRoute) => route.models.map((entry) => entry.modelId);

/** Task x plan x mode -> ordered models. Every save validates the whole list and bumps the version. */
@Injectable()
export class AdminAiRoutesService {
  constructor(
    private readonly repo: AdminAiRoutesRepo,
    private readonly modelsRepo: AdminAiModelsRepo,
    private readonly settings: SettingsService,
  ) {}

  async list() {
    const rows = await this.repo.list();
    const models = await this.modelsById(rows.flatMap((row) => modelIdsOf(row.route)));
    const items = rows
      .map((row) => routeView(row, models))
      .sort(
        (a, b) =>
          orderOf(AI_TASKS, a.task) - orderOf(AI_TASKS, b.task) ||
          (a.planKey ?? "").localeCompare(b.planKey ?? "") ||
          orderOf(AI_MODES, a.mode) - orderOf(AI_MODES, b.mode),
      );
    const defaults = new Map(
      items
        .filter((item) => item.planId === null)
        .map((item) => [`${item.task}/${item.mode}`, item.id]),
    );
    return {
      items,
      matrix: AI_TASKS.flatMap((task) =>
        AI_MODES.map((mode) => ({ task, mode, routeId: defaults.get(`${task}/${mode}`) ?? null })),
      ),
    };
  }

  async put(input: PutRouteInput, audit: AuditScope): Promise<RouteView> {
    const planKey = input.planId === null ? null : await this.repo.planKey(input.planId);
    if (planKey === undefined) throw new AppError(ErrorCode.NOT_FOUND);

    const models = await this.modelsById(input.models.map((entry) => entry.modelId));
    const ai = await this.settings.get("ai");
    this.validate(input, models, ai.allowPreviewModels);

    const outcome = await this.repo.save(
      { task: input.task, planId: input.planId, mode: input.mode },
      input.models,
      input.expectedVersion,
    );
    if (outcome.kind === "stale_version") throw conflict("stale_version");

    const names = await this.modelsById([
      ...modelIdsOf(outcome.after),
      ...(outcome.before ? modelIdsOf(outcome.before) : []),
    ]);
    const summary = (route: AiTaskRoute) => ({
      task: route.task,
      mode: route.mode,
      planKey,
      version: route.version,
      models: modelIdsOf(route).map((id) => names.get(id)?.model.displayName ?? "(removed)"),
    });
    audit.targetId = outcome.after.id;
    if (outcome.before) audit.before = summary(outcome.before);
    audit.after = summary(outcome.after);
    return routeView({ route: outcome.after, planKey }, names);
  }

  async remove(id: string, audit: AuditScope): Promise<void> {
    const row = await this.repo.find(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    // The default route is what every plan without its own falls back to: it is edited, not removed.
    if (row.route.planId === null) throw conflict("default_route");
    if (!(await this.repo.remove(id))) throw new AppError(ErrorCode.NOT_FOUND);

    const names = await this.modelsById(modelIdsOf(row.route));
    audit.targetId = id;
    audit.before = {
      task: row.route.task,
      mode: row.route.mode,
      planKey: row.planKey,
      version: row.route.version,
      models: modelIdsOf(row.route).map(
        (model) => names.get(model)?.model.displayName ?? "(removed)",
      ),
    };
  }

  /** The first problem found (unknown models first, then in list order): the editor highlights `details.index`. */
  private validate(
    input: PutRouteInput,
    models: ReadonlyMap<string, ModelRow>,
    allowPreview: boolean,
  ): void {
    for (const [index, entry] of input.models.entries()) {
      if (!models.has(entry.modelId)) throw refuse("unknown_model", index);
    }
    const required = REQUIRED_CAPABILITIES[input.task] ?? [];
    for (const [index, entry] of input.models.entries()) {
      const found = models.get(entry.modelId);
      if (!found) continue;
      if (index === 0 && !found.model.enabled) throw refuse("primary_disabled", index);

      const needs = entry.params.search === true ? [...required, "search" as const] : required;
      if (needs.some((capability) => !found.model.capabilities.includes(capability))) {
        throw refuse("missing_capability", index);
      }
      if (MEDICAL_AI_TASKS.has(input.task) && found.provider.dataPolicy === "free_tier") {
        throw refuse("free_tier_medical", index);
      }
      if (!allowPreview && isPreviewModel(found.model.modelId)) {
        throw refuse("preview_not_allowed", index);
      }
    }
  }

  private async modelsById(ids: readonly string[]): Promise<Map<string, ModelRow>> {
    const rows = await this.modelsRepo.findMany([...new Set(ids)]);
    return new Map(rows.map((row) => [row.model.id, row]));
  }
}
