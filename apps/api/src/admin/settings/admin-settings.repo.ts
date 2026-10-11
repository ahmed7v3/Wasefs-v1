import { Inject, Injectable } from "@nestjs/common";
import { siteSettings } from "@wasfa/db";

import { DB, type DbHandle } from "../../common/database.js";

export interface SettingMeta {
  key: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/** Who last changed each stored setting. Values come from `SettingsService` (cached, validated). */
@Injectable()
export class AdminSettingsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async meta(): Promise<Map<string, SettingMeta>> {
    const rows = await this.handle.db
      .select({
        key: siteSettings.key,
        updatedAt: siteSettings.updatedAt,
        updatedBy: siteSettings.updatedBy,
      })
      .from(siteSettings);
    return new Map(rows.map((row) => [row.key, row]));
  }
}
