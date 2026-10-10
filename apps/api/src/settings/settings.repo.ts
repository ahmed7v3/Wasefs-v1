import { Inject, Injectable } from "@nestjs/common";
import { siteSettings } from "@wasfa/db";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

/** The only database access of site settings. Global rows: there is no owner to scope by. */
@Injectable()
export class SettingsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The stored JSON of one key, `undefined` when the row does not exist (the default applies). */
  async find(key: string): Promise<{ value: unknown } | undefined> {
    const [row] = await this.handle.db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.key, key));
    return row;
  }

  async upsert(key: string, value: unknown, updatedBy: string | null): Promise<void> {
    const now = new Date();
    await this.handle.db
      .insert(siteSettings)
      .values({ key, value, updatedBy })
      .onConflictDoUpdate({
        target: siteSettings.key,
        set: { value, updatedBy, updatedAt: now },
      });
  }
}
