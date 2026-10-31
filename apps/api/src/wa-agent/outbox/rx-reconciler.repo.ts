import { Inject, Injectable } from "@nestjs/common";
import { rxAnalyses, waOutbox } from "@wasfa/db";
import { and, asc, eq, lt } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

/** The one query of the rx reconciler (docs/WA-AGENT-RUNTIME.md section 17.3, step 6). */
@Injectable()
export class RxReconcilerRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** WhatsApp analyses still `queued` since before `before` (oldest first): their job may never have been added. */
  async stuckQueued(before: Date, limit: number): Promise<string[]> {
    const rows = await this.handle.db
      .select({ id: rxAnalyses.id })
      .from(rxAnalyses)
      .innerJoin(waOutbox, and(eq(waOutbox.kind, "rx_result"), eq(waOutbox.refId, rxAnalyses.id)))
      .where(and(eq(rxAnalyses.status, "queued"), lt(rxAnalyses.queuedAt, before)))
      .orderBy(asc(rxAnalyses.queuedAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
