import { and, eq, gte, isNull, sql } from "drizzle-orm";

import {
  activeIngredients,
  drugAliases,
  drugImportBatches,
  drugs,
  type DrugImportBatch,
} from "./schema/index.js";

import type { Database } from "./client.js";

/*
 * Rollback of a committed drug import (Task 2.7). What a batch did is recoverable only in part,
 * because the tables keep no history:
 *  - rows it INSERTED (tagged with the batch and created at or after the commit started) are deleted,
 *    with their ingredient links and aliases (cascade);
 *  - rows it only UPDATED are un-tagged, but keep their new values (prices and the other list
 *    columns included: no history is kept, so they are not restored);
 *  - ingredients it created are deleted unless another drug uses them, otherwise un-tagged;
 *  - aliases it added to drugs that stay are deleted.
 * One transaction, with the batch row locked so a double click cannot run it twice.
 */

export type RollbackOutcome =
  | {
      kind: "rolled_back";
      deletedDrugs: number;
      untaggedDrugs: number;
      deletedIngredients: number;
      deletedAliases: number;
    }
  | { kind: "not_found" }
  | { kind: "not_committed"; status: DrugImportBatch["status"] };

export async function rollbackDrugImport(db: Database, batchId: string): Promise<RollbackOutcome> {
  return await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(drugImportBatches)
      .where(eq(drugImportBatches.id, batchId))
      .for("update");
    if (batch === undefined) return { kind: "not_found" } as const;
    if (batch.status !== "committed" || batch.committedAt === null) {
      return { kind: "not_committed", status: batch.status } as const;
    }

    // Aliases first: those on drugs that are about to be deleted vanish with them, but are counted.
    const aliases = await tx
      .delete(drugAliases)
      .where(eq(drugAliases.importBatchId, batchId))
      .returning({ id: drugAliases.id });
    const deleted = await tx
      .delete(drugs)
      .where(and(eq(drugs.importBatchId, batchId), gte(drugs.createdAt, batch.committedAt)))
      .returning({ id: drugs.id });
    const untagged = await tx
      .update(drugs)
      .set({ importBatchId: null })
      .where(eq(drugs.importBatchId, batchId))
      .returning({ id: drugs.id });
    const ingredients = await tx
      .delete(activeIngredients)
      .where(
        and(
          eq(activeIngredients.importBatchId, batchId),
          sql`not exists (select 1 from drug_ingredients di where di.ingredient_id = ${activeIngredients.id})`,
        ),
      )
      .returning({ id: activeIngredients.id });
    await tx
      .update(activeIngredients)
      .set({ importBatchId: null })
      .where(eq(activeIngredients.importBatchId, batchId));
    await tx
      .update(drugImportBatches)
      .set({ status: "rolled_back", rolledBackAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(drugImportBatches.id, batchId), isNull(drugImportBatches.rolledBackAt)));

    return {
      kind: "rolled_back",
      deletedDrugs: deleted.length,
      untaggedDrugs: untagged.length,
      deletedIngredients: ingredients.length,
      deletedAliases: aliases.length,
    } as const;
  });
}
