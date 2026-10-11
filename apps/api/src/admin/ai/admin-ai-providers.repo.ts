import { Inject, Injectable } from "@nestjs/common";
import {
  aiModels,
  aiProviders,
  isUniqueViolation,
  type AiProvider,
  type NewAiProvider,
} from "@wasfa/db";
import { asc, count, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface ProviderRow extends AiProvider {
  modelCount: number;
}

type PatchableField = "baseUrl" | "dataPolicy" | "priority" | "enabled" | "apiKeyEnc" | "keyHint";

/** What an admin may change on a provider; `undefined` = leave as is. The key is replaced, never merged. */
export type ProviderPatch = { [K in PatchableField]?: NewAiProvider[K] | undefined };

export type RemoveOutcome =
  { kind: "deleted"; provider: AiProvider } | { kind: "not_found" } | { kind: "in_use" };

const KEY_CONSTRAINT = "ai_providers_key_key";

@Injectable()
export class AdminAiProvidersRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private select() {
    return this.handle.db
      .select({
        provider: aiProviders,
        modelCount: sql<number>`(select count(*)::int from ${aiModels} where ${aiModels}."provider_id" = ${aiProviders}."id")`,
      })
      .from(aiProviders);
  }

  async list(): Promise<ProviderRow[]> {
    const rows = await this.select().orderBy(asc(aiProviders.priority), asc(aiProviders.key));
    return rows.map((row) => ({ ...row.provider, modelCount: row.modelCount }));
  }

  async findWithCount(id: string): Promise<ProviderRow | undefined> {
    const [row] = await this.select().where(eq(aiProviders.id, id));
    return row ? { ...row.provider, modelCount: row.modelCount } : undefined;
  }

  async find(id: string): Promise<AiProvider | undefined> {
    const [row] = await this.handle.db.select().from(aiProviders).where(eq(aiProviders.id, id));
    return row;
  }

  /** `undefined` when the key is taken. */
  async create(values: NewAiProvider): Promise<AiProvider | undefined> {
    try {
      const [row] = await this.handle.db.insert(aiProviders).values(values).returning();
      if (!row) throw new Error("Provider was not stored");
      return row;
    } catch (error) {
      if (isUniqueViolation(error, KEY_CONSTRAINT)) return undefined;
      throw error;
    }
  }

  async update(id: string, patch: ProviderPatch): Promise<AiProvider | undefined> {
    const [row] = await this.handle.db
      .update(aiProviders)
      .set(patch)
      .where(eq(aiProviders.id, id))
      .returning();
    return row;
  }

  async recordTest(
    id: string,
    result: { at: Date; ok: boolean; error: string | null },
  ): Promise<void> {
    await this.handle.db
      .update(aiProviders)
      .set({ lastTestAt: result.at, lastTestOk: result.ok, lastTestError: result.error })
      .where(eq(aiProviders.id, id));
  }

  /** Refuses a provider that has models: they carry the usage and spend history. */
  remove(id: string): Promise<RemoveOutcome> {
    return this.handle.db.transaction(async (tx) => {
      const [provider] = await tx
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.id, id))
        .for("update");
      if (!provider) return { kind: "not_found" } as const;
      const [used] = await tx
        .select({ models: count() })
        .from(aiModels)
        .where(eq(aiModels.providerId, id));
      if ((used?.models ?? 0) > 0) return { kind: "in_use" } as const;
      await tx.delete(aiProviders).where(eq(aiProviders.id, id));
      return { kind: "deleted", provider } as const;
    });
  }
}
