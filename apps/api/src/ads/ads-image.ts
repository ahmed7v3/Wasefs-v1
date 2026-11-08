import type { MediaVariant } from "@wasfa/shared/schemas/media";

/** The parts of a media asset the ad image choice reads. */
export interface AdMediaInfo {
  status: string;
  width: number | null;
  height: number | null;
  variants: readonly Pick<MediaVariant, "format" | "width" | "key">[];
}

export interface AdImage {
  url: string;
  width: number;
  height: number;
}

/**
 * The smallest published variant at least `wantedWidth` wide (webp first), else the largest; null
 * while the asset is not `ready` or no public media origin is configured. One place for delivery
 * (the slot) and the admin preview, so what the admin sees is what visitors get.
 */
export function pickAdImage(
  media: AdMediaInfo | null,
  wantedWidth: number,
  origin: string | undefined,
): AdImage | null {
  if (!origin || !media || media.status !== "ready" || !media.width || !media.height) return null;
  const byWidth = (a: { width: number }, b: { width: number }) => a.width - b.width;
  const webp = media.variants.filter((variant) => variant.format === "webp").sort(byWidth);
  const variants = webp.length > 0 ? webp : [...media.variants].sort(byWidth);
  const chosen = variants.find((variant) => variant.width >= wantedWidth) ?? variants.at(-1);
  if (!chosen) return null;
  return {
    url: `${origin.replace(/\/$/, "")}/${chosen.key}`,
    width: chosen.width,
    height: Math.max(1, Math.round((chosen.width * media.height) / media.width)),
  };
}
