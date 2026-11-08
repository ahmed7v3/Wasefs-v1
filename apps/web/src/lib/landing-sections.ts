import { LANDING_SECTION_KEYS, type LandingSectionKey } from "@wasfa/shared/settings";

export interface LandingSectionSetting {
  key: LandingSectionKey;
  enabled: boolean;
  order: number;
}

/**
 * The home sections to render, in order. Stored settings may list only some keys (or repeat one):
 * the first entry of a key wins and every unlisted key keeps its default place after the listed
 * ones, enabled. A disabled key is dropped here, so the page leaves no gap for it.
 */
export function visibleLandingSections(
  sections: readonly LandingSectionSetting[],
): LandingSectionKey[] {
  const seen = new Set<LandingSectionKey>();
  const listed = sections.filter((section) => {
    if (seen.has(section.key)) return false;
    seen.add(section.key);
    return true;
  });
  const unlisted = LANDING_SECTION_KEYS.filter((key) => !seen.has(key)).map((key) => ({
    key,
    enabled: true,
    order: Number.POSITIVE_INFINITY,
  }));
  const defaultIndex = (key: LandingSectionKey) => LANDING_SECTION_KEYS.indexOf(key);
  return [...listed, ...unlisted]
    .sort((a, b) => a.order - b.order || defaultIndex(a.key) - defaultIndex(b.key))
    .filter((section) => section.enabled)
    .map((section) => section.key);
}
