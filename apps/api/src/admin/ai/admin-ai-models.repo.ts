import { Inject, Injectable } from "@nestjs/common";
import {
  aiModels,
  aiProviders,
  aiTaskRoutes,
  isForeignKeyViolation,
  isUniqueViolation,
  type AiModel,
  type AiProvider,
  type NewAiModel,
} from "@wasfa/db";
import { asc, eq, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { PriceSyncField } from "@wasfa/shared/schemas/admin-ai";

export interface ModelRow {
  model: AiModel;
  provider: Pick<AiProvider, "id" | "key" | "kind" | "enabled" | "dataPolicy">;
  usedInRoutes: number;
}

type PatchableField =
  | "displayName"
  | "capabilities"
  | "contextTokens"
  | "priceInputUsdMicrosPerM"
  | "priceCachedInputUsdMicrosPerM"
  | "priceOutputUsdMicrosPerM"
  | "priceSearchUsdMicros"
  | "creditMultiplierBp"
  | "enabled"
  | "priceSource"
  | "priceCheckedAt";

/** The fields of a model an admin may change; `undefined` = leave as is. */
export type ModelPatch = { [K in PatchableField]?: NewAiModel[K] | undefined };

export type UpdateOutcome =
  | { kind: "updated"; before: AiModel; after: AiModel }
  | { kind: "not_found" }
  | { kind: "is_primary"; routes: number };

export type RemoveOutcome =
  { kind: "deleted"; model: AiModel } | { kind: "not_found" } | { kind: "in_use" };

const MODEL_CONSTRAINT = "ai_models_provider_model_key";

/** Routes whose list contains the model anywhere (`models` is `[{modelId, params}]`). */
const routesUsing = (id: string) =>
  sql`${aiTaskRoutes.models} @> jsonb_build_array(jsonb_build_object('modelId', ${id}::text))`;

/** Routes whose FIRST entry (the primary) is the model. */
const routesLeadingWith = (id: string) => sql`${aiTaskRoutes.models}->0->>'modelId' = ${id}::text`;

@Injectable()
export class AdminAiModelsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private select() {
    return this.handle.db
      .select({
        model: aiModels,
        provider: {
          id: aiProviders.id,
          key: aiProviders.key,
          kind: aiProviders.kind,
          enabled: aiProviders.enabled,
          dataPolicy: aiProviders.dataPolicy,
        },
        usedInRoutes: sql<number>`(select count(*)::int from ${aiTaskRoutes} where ${aiTaskRoutes.models} @> jsonb_build_array(jsonb_build_object('modelId', ${aiModels.id}::text)))`,
      })
      .from(aiModels)
      .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId));
  }

  async list(providerId?: string): Promise<ModelRow[]> {
    return await this.select()
      .where(providerId === undefined ? undefined : eq(aiModels.providerId, providerId))
      .orderBy(asc(aiProviders.priority), asc(aiProviders.key), asc(aiModels.modelId));
  }

  async find(id: string): Promise<ModelRow | undefined> {
    const [row] = await this.select().where(eq(aiModels.id, id));
    return row;
  }

  async findMany(ids: readonly string[]): Promise<ModelRow[]> {
    if (ids.length === 0) return [];
    return await this.select().where(inArray(aiModels.id, [...ids]));
  }

  /** `undefined` when the provider already has this model id. */
  async create(values: NewAiModel): Promise<AiModel | undefined> {
    try {
      const [row] = await this.handle.db.insert(aiModels).values(values).returning();
      if (!row) throw new Error("Model was not stored");
      return row;
    } catch (error) {
      if (isUniqueViolation(error, MODEL_CONSTRAINT)) return undefined;
      throw error;
    }
  }

  /** Switching a model off is refused while any route leads with it. */
  update(id: string, patch: ModelPatch): Promise<UpdateOutcome> {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx.select().from(aiModels).where(eq(aiModels.id, id)).for("update");
      if (!before) return { kind: "not_found" } as const;
      if (patch.enabled === false && before.enabled) {
        const primary = await tx
          .select({ id: aiTaskRoutes.id })
          .from(aiTaskRoutes)
          .where(routesLeadingWith(id));
        if (primary.length > 0) return { kind: "is_primary", routes: primary.length } as const;
      }
      const [after] = await tx.update(aiModels).set(patch).where(eq(aiModels.id, id)).returning();
      if (!after) throw new Error("Model was not updated");
      return { kind: "updated", before, after } as const;
    });
  }

  /**
   * Refuses a model that any route lists, primary or fallback, and one with spend history
   * (`ai_spend_daily` restricts the delete).
   */
  async remove(id: string): Promise<RemoveOutcome> {
    try {
      return await this.handle.db.transaction(async (tx) => {
        const [model] = await tx.select().from(aiModels).where(eq(aiModels.id, id)).for("update");
        if (!model) return { kind: "not_found" } as const;
        const used = await tx
          .select({ id: aiTaskRoutes.id })
          .from(aiTaskRoutes)
          .where(routesUsing(id))
          .limit(1);
        if (used.length > 0) return { kind: "in_use" } as const;
        await tx.delete(aiModels).where(eq(aiModels.id, id));
        return { kind: "deleted", model } as const;
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) return { kind: "in_use" };
      throw error;
    }
  }

  /**
   * Writes the synced prices: one transaction, each touched model once. Models deleted since the
   * preview are skipped. Returns the number of models that were updated.
   */
  applyPrices(
    changes: readonly { modelId: string; field: PriceSyncField; after: number }[],
    at: Date,
  ): Promise<number> {
    const byModel = new Map<string, ModelPatch>();
    for (const change of changes) {
      byModel.set(change.modelId, { ...byModel.get(change.modelId), [change.field]: change.after });
    }
    return this.handle.db.transaction(async (tx) => {
      let updated = 0;
      for (const [id, patch] of byModel) {
        const rows = await tx
          .update(aiModels)
          .set({ ...patch, priceSource: "openrouter_sync", priceCheckedAt: at })
          .where(eq(aiModels.id, id))
          .returning({ id: aiModels.id });
        updated += rows.length;
      }
      return updated;
    });
  }
}
