import { siteSettings, type Database } from "@wasfa/db";
import {
  SETTINGS_REGISTRY,
  settingDefault,
  type SettingKey,
  type SettingValue,
} from "@wasfa/shared/settings";
import { eq } from "drizzle-orm";

/**
 * A `site_settings` value, validated by the registry schema. A missing or unreadable row yields the
 * code default (AGENT 5.9), exactly as the API's SettingsService does. No cache: the worker reads
 * two settings per job, and an admin's change (a kill switch above all) must apply to the next job.
 */
export async function readSetting<K extends SettingKey>(
  db: Database,
  key: K,
): Promise<SettingValue<K>> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, key)).limit(1);
  if (row === undefined) return settingDefault(key);
  const parsed = SETTINGS_REGISTRY[key].schema.safeParse(row.value);
  return parsed.success ? (parsed.data as SettingValue<K>) : settingDefault(key);
}
