import { Inject, Injectable } from "@nestjs/common";
import {
  activeIngredients,
  drugAliases,
  drugIngredients,
  drugLearned,
  drugUnmatchedNames,
  drugs,
  isForeignKeyViolation,
  isUniqueViolation,
  promoteLearnedAlias,
  type Drug,
  type DrugAlias,
  type DrugLearned,
  type DrugUnmatchedName,
} from "@wasfa/db";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { DrugColumns } from "@wasfa/shared/drugs";
import type { DRUG_MISSING_FIELDS } from "@wasfa/shared/schemas/admin-drugs";

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
  DrugColumns & {
    manufacturer: string | null;
    country: string | null;
    status: Drug["status"];
    category: string | null;
    packText: string | null;
    unitsCount: number | null;
    barcode: string | null;
    priceMinor: number | null;
    oldPriceMinor: number | null;
    currency: string;
    priceUpdatedAt: Date;
  }
>;

/** An ingredient ready to store: the name as typed, its normalized key and its parsed strength. */
export interface IngredientValues {
  nameEn: string;
  nameAr: string | null;
  normalized: string;
  strengthText: string | null;
  strengthValueMicro: number | null;
  strengthUnit: string | null;
}

export interface DrugFilter {
  category?: string | undefined;
  manufacturer?: string | undefined;
  missing?: (typeof DRUG_MISSING_FIELDS)[number] | undefined;
  status?: Drug["status"] | undefined;
  edited?: boolean | undefined;
}

type Tx = Parameters<Parameters<DbHandle["db"]["transaction"]>[0]>[0];

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

  /**
   * What the browser shows before anything is typed: a page of drugs by brand name, narrowed by the
   * filters. One id more than `limit` is read so the caller knows whether a next page exists.
   */
  async listIds(filter: DrugFilter, limit: number, offset: number): Promise<string[]> {
    const conditions: (SQL | undefined)[] = [
      filter.category === undefined ? undefined : eq(drugs.category, filter.category),
      filter.manufacturer === undefined ? undefined : eq(drugs.manufacturer, filter.manufacturer),
      filter.status === undefined ? undefined : eq(drugs.status, filter.status),
      filter.edited === undefined
        ? undefined
        : filter.edited
          ? isNotNull(drugs.adminEditedAt)
          : isNull(drugs.adminEditedAt),
      filter.missing === "ingredient"
        ? sql`not exists (select 1 from ${drugIngredients} where ${drugIngredients.drugId} = ${drugs.id})`
        : undefined,
      filter.missing === "price" ? isNull(drugs.priceMinor) : undefined,
      filter.missing === "category"
        ? or(isNull(drugs.category), eq(drugs.category, ""))
        : undefined,
    ];
    const rows = await this.handle.db
      .select({ id: drugs.id })
      .from(drugs)
      .where(and(...conditions))
      .orderBy(asc(drugs.brandEn), asc(drugs.id))
      .limit(limit + 1)
      .offset(offset);
    return rows.map((row) => row.id);
  }

  /** Distinct categories with their entry counts, the most used first. */
  categories(limit: number): Promise<{ category: string; count: number }[]> {
    return this.handle.db
      .select({ category: sql<string>`${drugs.category}`, count: sql<number>`count(*)::int` })
      .from(drugs)
      .where(and(isNotNull(drugs.category), ne(drugs.category, "")))
      .groupBy(drugs.category)
      .orderBy(desc(sql`count(*)`), asc(drugs.category))
      .limit(limit);
  }

  /** Finds or creates the ingredients by normalized name and returns their ids. */
  private async ensureIngredients(
    tx: Tx,
    ingredients: readonly IngredientValues[],
  ): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    const normalized = [...new Set(ingredients.map((ingredient) => ingredient.normalized))];
    if (normalized.length === 0) return ids;
    const lookup = () =>
      tx
        .select({ id: activeIngredients.id, normalized: activeIngredients.normalized })
        .from(activeIngredients)
        .where(inArray(activeIngredients.normalized, normalized));
    for (const row of await lookup()) ids.set(row.normalized, row.id);
    const missing = ingredients.filter((ingredient) => !ids.has(ingredient.normalized));
    if (missing.length > 0) {
      await tx
        .insert(activeIngredients)
        .values(
          [...new Map(missing.map((m) => [m.normalized, m])).values()].map((ingredient) => ({
            nameEn: ingredient.nameEn,
            nameAr: ingredient.nameAr,
            normalized: ingredient.normalized,
          })),
        )
        .onConflictDoNothing();
      for (const row of await lookup()) ids.set(row.normalized, row.id);
    }
    return ids;
  }

  /** Replaces a drug's ingredient links (an ingredient named twice keeps its first strength). */
  private async setIngredients(
    tx: Tx,
    drugId: string,
    ingredients: readonly IngredientValues[],
  ): Promise<void> {
    await tx.delete(drugIngredients).where(eq(drugIngredients.drugId, drugId));
    if (ingredients.length === 0) return;
    const ids = await this.ensureIngredients(tx, ingredients);
    const links = new Map<string, typeof drugIngredients.$inferInsert>();
    for (const ingredient of ingredients) {
      const ingredientId = ids.get(ingredient.normalized);
      if (ingredientId === undefined || links.has(ingredientId)) continue;
      links.set(ingredientId, {
        drugId,
        ingredientId,
        strengthText: ingredient.strengthText,
        strengthValueMicro: ingredient.strengthValueMicro,
        strengthUnit: ingredient.strengthUnit,
      });
    }
    if (links.size > 0) await tx.insert(drugIngredients).values([...links.values()]);
  }

  /** A new manual entry with its ingredients, protected from re-imports from the start. */
  create(
    values: typeof drugs.$inferInsert,
    ingredients: readonly IngredientValues[],
  ): Promise<Drug> {
    return this.handle.db.transaction(async (tx) => {
      const [drug] = await tx
        .insert(drugs)
        .values({ ...values, adminEditedAt: sql`now()` })
        .returning();
      if (!drug) throw new Error("Drug was not stored");
      await this.setIngredients(tx, drug.id, ingredients);
      return drug;
    });
  }

  update(
    id: string,
    patch: DrugPatch,
    ingredients?: readonly IngredientValues[],
  ): Promise<UpdateOutcome> {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx.select().from(drugs).where(eq(drugs.id, id)).for("update");
      if (!before) return { kind: "not_found" } as const;
      const [after] = await tx
        .update(drugs)
        // An admin edit protects the row from a re-import (docs/MEDICATIONS.md §2).
        .set({ ...patch, updatedAt: sql`now()`, adminEditedAt: sql`now()` })
        .where(eq(drugs.id, id))
        .returning();
      if (!after) throw new Error("Drug was not updated");
      if (ingredients !== undefined) await this.setIngredients(tx, id, ingredients);
      return { kind: "updated", before, after } as const;
    });
  }

  /** Hard delete; links and aliases cascade, unmatched entries forget the mapping. */
  async remove(id: string): Promise<Drug | undefined> {
    const [removed] = await this.handle.db.delete(drugs).where(eq(drugs.id, id)).returning();
    return removed;
  }

  // --- Review queues ---

  async unmatched(
    status: DrugUnmatchedName["status"],
    limit: number,
    offset: number,
  ): Promise<(DrugUnmatchedName & { mappedBrandEn: string | null })[]> {
    const rows = await this.handle.db
      .select({ entry: drugUnmatchedNames, mappedBrandEn: drugs.brandEn })
      .from(drugUnmatchedNames)
      .leftJoin(drugs, eq(drugs.id, drugUnmatchedNames.mappedDrugId))
      .where(eq(drugUnmatchedNames.status, status))
      .orderBy(
        desc(drugUnmatchedNames.hits),
        desc(drugUnmatchedNames.lastSeen),
        asc(drugUnmatchedNames.normalized),
      )
      .limit(limit + 1)
      .offset(offset);
    return rows.map((row) => ({ ...row.entry, mappedBrandEn: row.mappedBrandEn }));
  }

  async findUnmatched(normalized: string): Promise<DrugUnmatchedName | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(drugUnmatchedNames)
      .where(eq(drugUnmatchedNames.normalized, normalized));
    return row;
  }

  /** Closes an unmatched reading as ignored; `false` when there is no such reading. */
  async ignoreUnmatched(normalized: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(drugUnmatchedNames)
      .set({ status: "ignored", mappedDrugId: null })
      .where(eq(drugUnmatchedNames.normalized, normalized))
      .returning({ normalized: drugUnmatchedNames.normalized });
    return rows.length > 0;
  }

  async learned(
    status: DrugLearned["status"],
    limit: number,
    offset: number,
  ): Promise<
    {
      learned: DrugLearned;
      brandEn: string;
      strengthText: string | null;
      form: string | null;
    }[]
  > {
    return await this.handle.db
      .select({
        learned: drugLearned,
        brandEn: drugs.brandEn,
        strengthText: drugs.strengthText,
        form: drugs.form,
      })
      .from(drugLearned)
      .innerJoin(drugs, eq(drugs.id, drugLearned.drugId))
      .where(eq(drugLearned.status, status))
      .orderBy(desc(drugLearned.votes), asc(drugLearned.normalized), asc(drugLearned.drugId))
      .limit(limit + 1)
      .offset(offset);
  }

  /** Makes the reading an alias of the drug and closes it in both queues (shared with auto-approval). */
  promote(input: {
    normalized: string;
    drugId: string;
    decidedBy: string;
    source: "learned" | "admin";
  }): Promise<void> {
    return promoteLearnedAlias(this.handle.db, input);
  }

  async findLearned(normalized: string, drugId: string): Promise<DrugLearned | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(drugLearned)
      .where(and(eq(drugLearned.normalized, normalized), eq(drugLearned.drugId, drugId)));
    return row;
  }

  /**
   * Marks the learned pair rejected and removes the alias it had become (only one the votes created,
   * `source = 'learned'`: an alias an admin typed stays).
   */
  rejectLearned(normalized: string, drugId: string, decidedBy: string): Promise<void> {
    return this.handle.db.transaction(async (tx) => {
      await tx
        .update(drugLearned)
        .set({ status: "rejected", decidedBy, decidedAt: sql`now()` })
        .where(and(eq(drugLearned.normalized, normalized), eq(drugLearned.drugId, drugId)));
      await tx
        .delete(drugAliases)
        .where(
          and(
            eq(drugAliases.drugId, drugId),
            eq(drugAliases.normalized, normalized),
            eq(drugAliases.source, "learned"),
          ),
        );
    });
  }

  async addAlias(values: typeof drugAliases.$inferInsert): Promise<AliasOutcome> {
    try {
      const alias = await this.handle.db.transaction(async (tx) => {
        const [inserted] = await tx.insert(drugAliases).values(values).returning();
        if (!inserted) throw new Error("Alias was not stored");
        // An alias is an admin edit too: the row is no longer the list's to overwrite.
        await tx
          .update(drugs)
          .set({ adminEditedAt: sql`now()` })
          .where(eq(drugs.id, values.drugId));
        return inserted;
      });
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
      await tx
        .update(drugs)
        .set({ adminEditedAt: sql`now()` })
        .where(eq(drugs.id, keepId));
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
