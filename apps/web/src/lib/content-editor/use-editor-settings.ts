"use client";

import { adminSettingsResponseSchema } from "@wasfa/shared/schemas/admin";
import { SETTINGS_REGISTRY } from "@wasfa/shared/settings";

import { DEFAULT_EDITOR_SETTINGS, type EditorSettings } from "../content-editor-schemas";
import { useResource } from "../use-admin-data";

/**
 * The `content` settings the editor shows (time zone, minimum words, featured-image width). Reading
 * settings needs `settings.read`, which an editor may not hold: any failure falls back to the defaults
 * (identical to the registry defaults) instead of blocking the screen.
 */
export function useEditorSettings(): EditorSettings {
  const resource = useResource("/admin/settings", adminSettingsResponseSchema);
  if (resource.status !== "ready")
    return { ...DEFAULT_EDITOR_SETTINGS, minWords: { ...DEFAULT_EDITOR_SETTINGS.minWords } };
  const row = resource.data.items.find((item) => item.key === "content");
  const parsed = SETTINGS_REGISTRY.content.schema.safeParse(row?.value ?? {});
  if (!parsed.success)
    return { ...DEFAULT_EDITOR_SETTINGS, minWords: { ...DEFAULT_EDITOR_SETTINGS.minWords } };
  const { timeZone, featuredMinWidth, minWords } = parsed.data;
  return { timeZone, featuredMinWidth, minWords };
}
