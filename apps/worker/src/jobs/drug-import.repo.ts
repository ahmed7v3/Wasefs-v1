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
import { and, eq, inArray, or, sql } from "drizzle-orm";

import {
  drugKey,
  refKey,
  type ExistingDrug,
  type ImportRow,
  type RowPlan,
} from "./drug-import.plan.js";

import type { DrugImportStatus, DrugSource } from "@wasfa/shared/ai";

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

/**
 * Existing drugs of one chunk, with their ingredients and aliases: by `drugKey` for the normalized
 * names of rows without a source id, and by `refKey` for the ids of rows that have one (matched
 * within `source`, the batch source).
 */
export async function findExisting(
  db: Database,
  source: DrugSource,
  names: readonly string[],
  refs: readonly string[],
): Promise<Map<string, ExistingDrug>> {
  const found = new Map<string, ExistingDrug>();
  if (names.length === 0 && refs.length === 0) return found;
  const byName = names.length > 0 ? inArray(drugs.normalizedEn, [...new Set(names)]) : undefined;
  const byRef =
    refs.length > 0
      ? and(eq(drugs.source, source), inArray(drugs.sourceRef, [...new Set(refs)]))
      : undefined;
  const rows = await db
    .select()
    .from(drugs)
    .where(or(byName, byRef))
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
    const existing: ExistingDrug = {
      id: row.id,
      brandEn: row.brandEn,
      normalizedEn: row.normalizedEn,
      brandAr: row.brandAr,
      brandKey: row.brandKey,
      form: row.form,
      strengthText: row.strengthText,
      strengthValueMicro: row.strengthValueMicro,
      strengthUnit: row.strengthUnit,
      manufacturer: row.manufacturer,
      country: row.country,
      category: row.category,
      priceMinor: row.priceMinor,
      oldPriceMinor: row.oldPriceMinor,
      packText: row.packText,
      unitsCount: row.unitsCount,
      barcode: row.barcode,
      sourceRef: row.sourceRef,
      adminEditedAt: row.adminEditedAt,
      importBatchId: row.importBatchId,
      createdAt: row.createdAt,
      ingredients: ingredientsByDrug.get(row.id) ?? new Set<string>(),
      aliases: aliasesByDrug.get(row.id) ?? new Set<string>(),
    };
    if (row.source === source && row.sourceRef !== null) {
      const refId = refKey(row.sourceRef);
      if (!found.has(refId)) found.set(refId, existing);
    }
    const key = drugKey(row);
    if (!found.has(key)) found.set(key, existing);
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
  source: DrugSource,
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
          category: row.category ?? null,
          priceMinor: row.priceMinor ?? null,
          oldPriceMinor: row.oldPriceMinor ?? null,
          packText: row.packText ?? null,
          unitsCount: row.unitsCount ?? null,
          barcode: row.barcode ?? null,
          source: row.sourceRef === null ? null : source,
          sourceRef: row.sourceRef,
          priceUpdatedAt: row.priceMinor == null ? null : new Date(),
        });
      } else {
        updated++;
        const changed = (field: string): boolean => plan.changes.includes(field);
        const c = row.columns;
        await tx
          .update(drugs)
          .set({
            ...(changed("brandAr") ? { brandAr: c.brandAr, normalizedAr: c.normalizedAr } : {}),
            ...(changed("brandEn")
              ? { brandEn: c.brandEn, normalizedEn: c.normalizedEn, brandKey: c.brandKey }
              : {}),
            ...(changed("brandKey") ? { brandKey: c.brandKey } : {}),
            ...(changed("form") ? { form: c.form } : {}),
            ...(changed("strength")
              ? {
                  strengthText: c.strengthText,
                  strengthValueMicro: c.strengthValueMicro,
                  strengthUnit: c.strengthUnit,
                }
              : {}),
            ...(changed("manufacturer") ? { manufacturer: row.manufacturer } : {}),
            ...(changed("country") ? { country: row.country } : {}),
            ...(changed("category") ? { category: row.category ?? null } : {}),
            ...(changed("price")
              ? { priceMinor: row.priceMinor ?? null, priceUpdatedAt: sql`now()` }
              : {}),
            ...(changed("oldPrice") ? { oldPriceMinor: row.oldPriceMinor ?? null } : {}),
            ...(changed("packText") ? { packText: row.packText ?? null } : {}),
            ...(changed("unitsCount") ? { unitsCount: row.unitsCount ?? null } : {}),
            ...(changed("barcode") ? { barcode: row.barcode ?? null } : {}),
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
