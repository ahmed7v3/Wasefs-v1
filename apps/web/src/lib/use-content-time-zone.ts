"use client";

import { adminSettingsResponseSchema } from "@wasfa/shared/schemas/admin";
import { SETTINGS_REGISTRY } from "@wasfa/shared/settings";

import { DEFAULT_CONTENT_TIME_ZONE, isValidTimeZone } from "./content-time";
import { useResource } from "./use-admin-data";

/**
 * The time zone of the `content` setting. Reading settings needs `settings.read`, which an editor may
 * not hold: any failure falls back to the default zone instead of blocking the screen.
 */
export function useContentTimeZone(): string {
  const resource = useResource("/admin/settings", adminSettingsResponseSchema);
  if (resource.status !== "ready") return DEFAULT_CONTENT_TIME_ZONE;
  const row = resource.data.items.find((item) => item.key === "content");
  const parsed = SETTINGS_REGISTRY.content.schema.safeParse(row?.value ?? {});
  if (!parsed.success || !isValidTimeZone(parsed.data.timeZone)) return DEFAULT_CONTENT_TIME_ZONE;
  return parsed.data.timeZone;
}
