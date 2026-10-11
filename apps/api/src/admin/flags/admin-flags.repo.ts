import { Inject, Injectable } from "@nestjs/common";
import { featureFlags } from "@wasfa/db";
import { asc, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface FlagAdminRow {
  key: string;
  enabled: boolean;
  rules: unknown;
  updatedAt: Date;
}

const columns = {
  key: featureFlags.key,
  enabled: featureFlags.enabled,
  rules: featureFlags.rules,
  updatedAt: featureFlags.updatedAt,
};

/** Flags straight from the table (never the cache), with the timestamp the evaluation path does not need. */
@Injectable()
export class AdminFlagsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  list(): Promise<FlagAdminRow[]> {
    return this.handle.db.select(columns).from(featureFlags).orderBy(asc(featureFlags.key));
  }

  async find(key: string): Promise<FlagAdminRow | undefined> {
    const [row] = await this.handle.db
      .select(columns)
      .from(featureFlags)
      .where(eq(featureFlags.key, key));
    return row;
  }
}
