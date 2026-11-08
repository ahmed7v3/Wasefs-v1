import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface PromptCounts {
  shown: number;
  clicked: number;
  dismissed: number;
}

/** Aggregate prompt events only: no row of any person's data leaves this file. */
@Injectable()
export class AdminPromptsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Shown, clicked and dismissed per prompt kind since `since`. */
  async counts(since: Date): Promise<Map<string, PromptCounts>> {
    const rows = await this.handle.db.execute<{ kind: string | null; name: string; total: number }>(sql`
      select props->>'kind' as kind, name, count(*)::int as total
      from growth_events
      where name in ('prompt_shown', 'prompt_clicked', 'prompt_dismissed')
        and occurred_at >= ${since.toISOString()}::timestamptz
      group by 1, 2
    `);
    const out = new Map<string, PromptCounts>();
    for (const row of rows) {
      if (row.kind === null) continue;
      const entry = out.get(row.kind) ?? { shown: 0, clicked: 0, dismissed: 0 };
      if (row.name === "prompt_shown") entry.shown = row.total;
      else if (row.name === "prompt_clicked") entry.clicked = row.total;
      else entry.dismissed = row.total;
      out.set(row.kind, entry);
    }
    return out;
  }
}
