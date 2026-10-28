import { brandKeyOf } from "@wasfa/shared/drugs";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import { drugs } from "./schema/index.js";

import type { Database } from "./client.js";

const CHUNK = 1_000;

/**
 * Fills `brand_key` for rows written before the column existed (`brand_key = ''`). Walks the table by
 * id so a row whose key is still empty (a name with no words) cannot make it loop. Safe to re-run.
 * Returns the number of rows that got a non-empty key.
 */
export async function backfillBrandKeys(db: Database): Promise<number> {
  let cursor: string | undefined;
  let filled = 0;
  for (;;) {
    const rows = await db
      .select({ id: drugs.id, brandEn: drugs.brandEn })
      .from(drugs)
      .where(
        cursor === undefined
          ? eq(drugs.brandKey, "")
          : and(eq(drugs.brandKey, ""), gt(drugs.id, cursor)),
      )
      .orderBy(asc(drugs.id))
      .limit(CHUNK);
    const last = rows.at(-1);
    if (last === undefined) return filled;
    cursor = last.id;

    const keyed = rows
      .map((row) => ({ id: row.id, key: brandKeyOf(row.brandEn) }))
      .filter((row) => row.key !== "");
    if (keyed.length === 0) continue;
    const values = sql.join(
      keyed.map((row) => sql`(${row.id}::uuid, ${row.key}::text)`),
      sql`, `,
    );
    await db.execute(
      sql`update drugs set brand_key = v.key from (values ${values}) as v(id, key) where drugs.id = v.id`,
    );
    filled += keyed.length;
  }
}
