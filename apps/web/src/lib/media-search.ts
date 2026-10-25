import type { MediaAsset } from "@wasfa/shared/schemas/media";

/**
 * Client-side search over the LOADED assets (the media list endpoint has no text filter): matches the
 * Arabic or English alt text, the caption and the original or SEO file name, case-insensitively.
 */
export function matchesMediaSearch(
  asset: Pick<MediaAsset, "altAr" | "altEn" | "caption" | "originalFilename" | "seoFilename">,
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return [asset.altAr, asset.altEn, asset.caption, asset.originalFilename, asset.seoFilename].some(
    (field) => field?.toLowerCase().includes(needle) === true,
  );
}
