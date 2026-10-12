import { Inject, Injectable } from "@nestjs/common";
import {
  drugImportBatches,
  rollbackDrugImport,
  type DrugImportBatch,
  type RollbackOutcome,
} from "@wasfa/db";
import { desc, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { DrugImportMapping } from "@wasfa/shared/drugs";

export type { RollbackOutcome };

@Injectable()
export class AdminDrugImportsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async create(values: {
    fileName: string;
    source: DrugImportBatch["source"];
    mapping: DrugImportMapping;
  }): Promise<DrugImportBatch> {
    const [row] = await this.handle.db.insert(drugImportBatches).values(values).returning();
    if (!row) throw new Error("Import batch was not stored");
    return row;
  }

  async find(id: string): Promise<DrugImportBatch | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(drugImportBatches)
      .where(eq(drugImportBatches.id, id));
    return row;
  }

  list(limit: number): Promise<DrugImportBatch[]> {
    return this.handle.db
      .select()
      .from(drugImportBatches)
      .orderBy(desc(drugImportBatches.createdAt), desc(drugImportBatches.id))
      .limit(limit);
  }

  async setMapping(id: string, mapping: DrugImportMapping): Promise<void> {
    await this.handle.db
      .update(drugImportBatches)
      .set({ mapping, updatedAt: sql`now()` })
      .where(eq(drugImportBatches.id, id));
  }

  rollback(id: string): Promise<RollbackOutcome> {
    return rollbackDrugImport(this.handle.db, id);
  }
}
