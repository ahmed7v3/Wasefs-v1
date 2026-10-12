import { Inject, Injectable } from "@nestjs/common";
import {
  activeIngredients,
  drugAliases,
  drugIngredients,
  drugs,
  isForeignKeyViolation,
  isUniqueViolation,
  type Drug,
  type DrugAlias,
} from "@wasfa/db";
import { desc, eq, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { DrugColumns } from "@wasfa/shared/drugs";

export interface DrugRow {
  drug: Drug;
  ingredients: {
    id: string;
    nameEn: string;
    nameAr: string | null;
    strengthText: string | null;
  }[];
  aliases: Pick<DrugAlias, "id" | "alias" | "lang" | "source">[];
}

/** What an edit may change: the derived columns together with the plain ones. */
export type DrugPatch = Partial<
  DrugColumns & { manufacturer: string | null; country: string | null; status: Drug["status"] }
>;

export type UpdateOutcome = { kind: "updated"; before: Drug; after: Drug } | { kind: "not_found" };

export type AliasOutcome =
  { kind: "added"; alias: DrugAlias } | { kind: "exists" } | { kind: "not_found" };

export type MergeOutcome =
  | {
      kind: "merged";
      kept: Drug;
      merged: Drug;
      movedAliases: number;
      movedIngredients: number;
    }
  | { kind: "not_found" };

const ALIAS_CONSTRAINT = "drug_aliases_drug_normalized_key";

@Injectable()
export class AdminDrugsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The drugs with their ingredients and aliases, in the order of `ids`. */
  async rows(ids: readonly string[]): Promise<DrugRow[]> {
    if (ids.length === 0) return [];
    const { db } = this.handle;
    const [drugRows, ingredientRows, aliasRows] = await Promise.all([
      db
        .select()
        .from(drugs)
        .where(inArray(drugs.id, [...ids])),
      db
        .select({
          drugId: drugIngredients.drugId,
          id: activeIngredients.id,
          nameEn: activeIngredients.nameEn,
          nameAr: activeIngredients.nameAr,
          strengthText: drugIngredients.strengthText,
        })
        .from(drugIngredients)
        .innerJoin(activeIngredients, eq(activeIngredients.id, drugIngredients.ingredientId))
        .where(inArray(drugIngredients.drugId, [...ids]))
        .orderBy(activeIngredients.nameEn),
      db
        .select({
          drugId: drugAliases.drugId,
          id: drugAliases.id,
          alias: drugAliases.alias,
          lang: drugAliases.lang,
          source: drugAliases.source,
        })
        .from(drugAliases)
        .where(inArray(drugAliases.drugId, [...ids]))
        .orderBy(drugAliases.createdAt, drugAliases.id),
    ]);
    const byId = new Map(drugRows.map((drug) => [drug.id, drug]));
    return ids.flatMap((id) => {
      const drug = byId.get(id);
      if (drug === undefined) return [];
      return [
        {
          drug,
          ingredients: ingredientRows
            .filter((row) => row.drugId === id)
            .map((row) => ({
              id: row.id,
              nameEn: row.nameEn,
              nameAr: row.nameAr,
              strengthText: row.strengthText,
            })),
          aliases: aliasRows
            .filter((row) => row.drugId === id)
            .map((row) => ({
              id: row.id,
              alias: row.alias,
              lang: row.lang,
              source: row.source,
            })),
        },
      ];
    });
  }

  async row(id: string): Promise<DrugRow | undefined> {
    return (await this.rows([id]))[0];
  }

  /** The most recently changed drugs: what the browser shows before anything is typed. */
  async recentIds(limit: number): Promise<string[]> {
    const rows = await this.handle.db
      .select({ id: drugs.id })
      .from(drugs)
      .orderBy(desc(drugs.updatedAt), desc(drugs.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  update(id: string, patch: DrugPatch): Promise<UpdateOutcome> {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx.select().from(drugs).where(eq(drugs.id, id)).for("update");
      if (!before) return { kind: "not_found" } as const;
      const [after] = await tx
        .update(drugs)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(drugs.id, id))
        .returning();
      if (!after) throw new Error("Drug was not updated");
      return { kind: "updated", before, after } as const;
    });
  }

  async addAlias(values: typeof drugAliases.$inferInsert): Promise<AliasOutcome> {
    try {
      const [alias] = await this.handle.db.insert(drugAliases).values(values).returning();
      if (!alias) throw new Error("Alias was not stored");
      return { kind: "added", alias };
    } catch (error) {
      if (isUniqueViolation(error, ALIAS_CONSTRAINT)) return { kind: "exists" };
      // The drug was deleted between the check and the insert.
      if (isForeignKeyViolation(error)) return { kind: "not_found" };
      throw error;
    }
  }

  /**
   * Folds `mergeId` into `keepId`: its ingredient links and aliases move over (what the target
   * already has is skipped), its own names become aliases of the target, then it is deleted.
   * Both rows are locked in id order so two merges cannot deadlock.
   */
  merge(keepId: string, mergeId: string): Promise<MergeOutcome> {
    return this.handle.db.transaction(async (tx) => {
      const locked = await tx
        .select()
        .from(drugs)
        .where(inArray(drugs.id, [keepId, mergeId]))
        .orderBy(drugs.id)
        .for("update");
      const kept = locked.find((drug) => drug.id === keepId);
      const merged = locked.find((drug) => drug.id === mergeId);
      if (!kept || !merged) return { kind: "not_found" } as const;

      const links = await tx
        .select()
        .from(drugIngredients)
        .where(eq(drugIngredients.drugId, mergeId));
      const movedLinks =
        links.length === 0
          ? []
          : await tx
              .insert(drugIngredients)
              .values(links.map((link) => ({ ...link, drugId: keepId })))
              .onConflictDoNothing()
              .returning({ ingredientId: drugIngredients.ingredientId });

      const aliases = await tx.select().from(drugAliases).where(eq(drugAliases.drugId, mergeId));
      const movedByName = aliases.map((alias) => ({
        alias: alias.alias,
        normalized: alias.normalized,
        lang: alias.lang,
        source: alias.source,
        importBatchId: alias.importBatchId,
        createdAt: alias.createdAt,
        drugId: keepId,
      }));
      // The merged drug's own names are worth keeping as search terms of the survivor.
      const ownNames = [
        { alias: merged.brandEn, normalized: merged.normalizedEn, lang: "en" as const },
        ...(merged.brandAr !== null && merged.normalizedAr !== null
          ? [{ alias: merged.brandAr, normalized: merged.normalizedAr, lang: "ar" as const }]
          : []),
      ]
        .filter(
          (name) => name.normalized !== kept.normalizedEn && name.normalized !== kept.normalizedAr,
        )
        .map((name) => ({
          ...name,
          drugId: keepId,
          source: "merge",
          importBatchId: null,
          createdAt: new Date(),
        }));
      const toInsert = [...movedByName, ...ownNames];
      const movedAliases =
        toInsert.length === 0
          ? []
          : await tx
              .insert(drugAliases)
              .values(toInsert)
              .onConflictDoNothing()
              .returning({ id: drugAliases.id });

      // Cascades remove the merged drug's remaining links and aliases.
      await tx.delete(drugs).where(eq(drugs.id, mergeId));
      return {
        kind: "merged",
        kept,
        merged,
        movedAliases: movedAliases.length,
        movedIngredients: movedLinks.length,
      } as const;
    });
  }
}
