import { Inject, Injectable } from "@nestjs/common";
import { siteSettings } from "@wasfa/db";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

/** When the stored `ai` setting last changed. The value itself comes from `SettingsService`. */
@Injectable()
export class AdminAiSettingsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async updatedAt(): Promise<Date | undefined> {
    const [row] = await this.handle.db
      .select({ updatedAt: siteSettings.updatedAt })
      .from(siteSettings)
      .where(eq(siteSettings.key, "ai"));
    return row?.updatedAt;
  }
}
