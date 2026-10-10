import { Inject, Injectable } from "@nestjs/common";
import { featureFlags } from "@wasfa/db";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { FlagRow } from "./flags.evaluate.js";

/** The only database access of feature flags. Global rows: there is no owner to scope by. */
@Injectable()
export class FlagsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async all(): Promise<FlagRow[]> {
    return this.handle.db
      .select({ key: featureFlags.key, enabled: featureFlags.enabled, rules: featureFlags.rules })
      .from(featureFlags);
  }

  async find(key: string): Promise<FlagRow | undefined> {
    const [row] = await this.handle.db
      .select({ key: featureFlags.key, enabled: featureFlags.enabled, rules: featureFlags.rules })
      .from(featureFlags)
      .where(eq(featureFlags.key, key));
    return row;
  }

  async upsert(key: string, enabled: boolean, rules: unknown): Promise<void> {
    await this.handle.db
      .insert(featureFlags)
      .values({ key, enabled, rules })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: { enabled, rules, updatedAt: new Date() },
      });
  }

  /** True when a row was removed. */
  async remove(key: string): Promise<boolean> {
    const rows = await this.handle.db
      .delete(featureFlags)
      .where(eq(featureFlags.key, key))
      .returning({ key: featureFlags.key });
    return rows.length > 0;
  }
}
