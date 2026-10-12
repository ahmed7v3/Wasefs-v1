import {
  activeIngredients,
  drugAliases,
  drugImportBatches,
  drugIngredients,
  drugs,
  type Database,
  type DrugImportBatch,
} from "@wasfa/db";
import { newId } from "@wasfa/shared/ids";
import { eq, inArray, sql } from "drizzle-orm";

import { drugKey, type ExistingDrug, type ImportRow, type RowPlan } from "./drug-import.plan.js";

import type { DrugImportStatus } from "@wasfa/shared/ai";

/*
 * Every database access of the drug import. The worker runs as the restricted role: it can read
 * and write the drug tables and the batch row, nothing else.
 */

export async function loadBatch(db: Database, id: string): Promise<DrugImportBatch | undefined> {
  const [row] = await db.select().from(drugImportBatches).where(eq(drugImportBatches.id, id));
  return row;
}

export interface BatchPatch {
  mapping?: Record<string, string>;
  rowsTotal?: number;
  rowsInserted?: number;
  rowsUpdated?: number;
  rowsSkipped?: number;
  status?: DrugImportStatus;
  committedBy?: string | null;
}

export async function updateBatch(db: Database, id: string, patch: BatchPatch): Promise<void> {
  await db
    .update(drugImportBatches)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(drugImportBatches.id, id));
}

/**
 * Stamps the start of the commit once (database clock, the same one that stamps `created_at`).
 * Rows of this batch created at or after it were inserted by it; older ones were updated.
 */
export async function markCommitStarted(
  db: Database,
  id: string,
  actorId: string | undefined,
): Promise<Date> {
  const [row] = await db
    .update(drugImportBatches)
    .set({
      committedAt: sql`coalesce(${drugImportBatches.committedAt}, now())`,
      committedBy: actorId ?? sql`${drugImportBatches.committedBy}`,
      updatedAt: sql`now()`,
    })
    .where(eq(drugImportBatches.id, id))
    .returning({ committedAt: drugImportBatches.committedAt });
  if (row?.committedAt == null) throw new Error("Batch disappeared during commit");
  return row.committedAt;
}

/** Existing drugs by key for the normalized names of one chunk, with their ingredients and aliases. */
export async function findExisting(
  db: Database,
  names: readonly string[],
): Promise<Map<string, ExistingDrug>> {
  const found = new Map<string, ExistingDrug>();
  if (names.length === 0) return found;
  const rows = await db
    .select()
    .from(drugs)
    .where(inArray(drugs.normalizedEn, [...new Set(names)]))
    // The oldest row wins when a table already holds the same drug twice.
    .orderBy(drugs.createdAt, drugs.id);
  if (rows.length === 0) return found;

  const ids = rows.map((row) => row.id);
  const [ingredientRows, aliasRows] = await Promise.all([
    db
      .select({ drugId: drugIngredients.drugId, normalized: activeIngredients.normalized })
      .from(drugIngredients)
      .innerJoin(activeIngredients, eq(activeIngredients.id, drugIngredients.ingredientId))
      .where(inArray(drugIngredients.drugId, ids)),
    db
      .select({ drugId: drugAliases.drugId, normalized: drugAliases.normalized })
      .from(drugAliases)
      .where(inArray(drugAliases.drugId, ids)),
  ]);
  const group = (items: readonly { drugId: string; normalized: string }[]) => {
    const byDrug = new Map<string, Set<string>>();
    for (const item of items) {
      const set = byDrug.get(item.drugId) ?? new Set<string>();
      set.add(item.normalized);
      byDrug.set(item.drugId, set);
    }
    return byDrug;
  };
  const ingredientsByDrug = group(ingredientRows);
  const aliasesByDrug = group(aliasRows);

  for (const row of rows) {
    const key = drugKey(row);
    if (found.has(key)) continue;
    found.set(key, {
      id: row.id,
      brandAr: row.brandAr,
      manufacturer: row.manufacturer,
      country: row.country,
      importBatchId: row.importBatchId,
      createdAt: row.createdAt,
      ingredients: ingredientsByDrug.get(row.id) ?? new Set<string>(),
      aliases: aliasesByDrug.get(row.id) ?? new Set<string>(),
    });
  }
  return found;
}

export interface WriteResult {
  inserted: number;
  updated: number;
}

/** Ids of the ingredients named by `rows`, creating the missing ones (tagged with the batch). */
async function ensureIngredients(
  tx: Database,
  rows: readonly ImportRow[],
  batchId: string,
): Promise<Map<string, string>> {
  const wanted = new Map<string, ImportRow["ingredients"][number]>();
  for (const row of rows) {
    for (const ingredient of row.ingredients) wanted.set(ingredient.normalized, ingredient);
  }
  const ids = new Map<string, string>();
  if (wanted.size === 0) return ids;
  const known = await tx
    .select({ id: activeIngredients.id, normalized: activeIngredients.normalized })
    .from(activeIngredients)
    .where(inArray(activeIngredients.normalized, [...wanted.keys()]));
  for (const row of known) ids.set(row.normalized, row.id);

  const missing = [...wanted.values()].filter((ingredient) => !ids.has(ingredient.normalized));
  if (missing.length > 0) {
    await tx
      .insert(activeIngredients)
      .values(
        missing.map((ingredient) => ({
          id: newId(),
          nameEn: ingredient.nameEn,
          nameAr: ingredient.nameAr,
          normalized: ingredient.normalized,
          importBatchId: batchId,
        })),
      )
      .onConflictDoNothing();
    const created = await tx
      .select({ id: activeIngredients.id, normalized: activeIngredients.normalized })
      .from(activeIngredients)
      .where(
        inArray(
          activeIngredients.normalized,
          missing.map((ingredient) => ingredient.normalized),
        ),
      );
    for (const row of created) ids.set(row.normalized, row.id);
  }
  return ids;
}

/**
 * Writes one chunk in a single transaction: new drugs, changed fields of existing ones, the
 * ingredient links and aliases they bring. Every row it touches is tagged with the batch.
 */
export async function writeChunk(
  db: Database,
  batchId: string,
  source: string,
  entries: readonly { row: ImportRow; plan: RowPlan }[],
): Promise<WriteResult> {
  const writes = entries.filter((entry) => entry.plan.write);
  if (writes.length === 0) return { inserted: 0, updated: 0 };

  return await db.transaction(async (tx) => {
    const ingredientIds = await ensureIngredients(
      tx as unknown as Database,
      writes.map((entry) => entry.row),
      batchId,
    );
    const links: (typeof drugIngredients.$inferInsert)[] = [];
    const aliases: (typeof drugAliases.$inferInsert)[] = [];
    const inserts: (typeof drugs.$inferInsert)[] = [];
    let updated = 0;

    for (const { row, plan } of writes) {
      const existing = plan.existing;
      const drugId = existing?.id ?? newId();
      if (existing === undefined) {
        inserts.push({
          id: drugId,
          ...row.columns,
          manufacturer: row.manufacturer,
          country: row.country,
          status: "active",
          importBatchId: batchId,
        });
      } else {
        updated++;
        await tx
          .update(drugs)
          .set({
            ...(plan.changes.includes("brandAr")
              ? { brandAr: row.columns.brandAr, normalizedAr: row.columns.normalizedAr }
              : {}),
            ...(plan.changes.includes("manufacturer") ? { manufacturer: row.manufacturer } : {}),
            ...(plan.changes.includes("country") ? { country: row.country } : {}),
            importBatchId: batchId,
            updatedAt: sql`now()`,
          })
          .where(eq(drugs.id, drugId));
      }
      for (const ingredient of row.ingredients) {
        if (existing?.ingredients.has(ingredient.normalized)) continue;
        const ingredientId = ingredientIds.get(ingredient.normalized);
        if (ingredientId === undefined) continue;
        links.push({
          drugId,
          ingredientId,
          strengthText: ingredient.strengthText,
          strengthValueMicro: ingredient.strengthValueMicro,
          strengthUnit: ingredient.strengthUnit,
        });
      }
      for (const alias of row.aliases) {
        if (existing?.aliases.has(alias.normalized)) continue;
        aliases.push({
          id: newId(),
          drugId,
          alias: alias.alias,
          normalized: alias.normalized,
          lang: alias.lang,
          source,
          importBatchId: batchId,
        });
      }
    }

    if (inserts.length > 0) await tx.insert(drugs).values(inserts);
    if (links.length > 0) await tx.insert(drugIngredients).values(links).onConflictDoNothing();
    if (aliases.length > 0) await tx.insert(drugAliases).values(aliases).onConflictDoNothing();
    return { inserted: inserts.length, updated };
  });
}
