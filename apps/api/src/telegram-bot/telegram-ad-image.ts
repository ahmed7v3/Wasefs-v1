import { MEDIA_FORMAT_MIME, type MediaVariant } from "@wasfa/shared/schemas/media";

import type { TelegramUpload } from "./telegram-api.client.js";

/** Telegram shows photos up to about 1280 px wide; a bigger file only costs upload time. */
const WANTED_WIDTH = 1_280;
/** A photo upload may be 10 MB; ads stay far below. */
export const AD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

export interface AdImageSource {
  status: string;
  variants: readonly Pick<MediaVariant, "format" | "width" | "key">[];
}

/**
 * The published variant to upload: JPEG first (the safest for Telegram), else WebP (never AVIF, which
 * Telegram does not render as a photo); the smallest one at least `WANTED_WIDTH` wide, else the widest.
 * Null while the asset is not `ready` or no public media origin is configured.
 */
export function pickTelegramAdVariant(
  media: AdImageSource | null,
  origin: string | undefined,
): { url: string; format: "jpeg" | "webp"; key: string } | null {
  if (!origin || !media || media.status !== "ready") return null;
  const byWidth = (a: { width: number }, b: { width: number }) => a.width - b.width;
  const of = (format: "jpeg" | "webp") =>
    media.variants.filter((variant) => variant.format === format).sort(byWidth);
  const format = of("jpeg").length > 0 ? "jpeg" : "webp";
  const list = of(format);
  const chosen = list.find((variant) => variant.width >= WANTED_WIDTH) ?? list.at(-1);
  if (!chosen) return null;
  return { url: `${origin.replace(/\/$/, "")}/${chosen.key}`, format, key: chosen.key };
}

/** Downloads the chosen variant; null on any failure (the ad then degrades to a card). */
export async function loadTelegramAdImage(
  media: AdImageSource | null,
  origin: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramUpload | null> {
  const variant = pickTelegramAdVariant(media, origin);
  if (variant === null) return null;
  try {
    const response = await fetchImpl(variant.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > AD_IMAGE_MAX_BYTES) return null;
    return {
      bytes,
      filename: `ad.${variant.format === "jpeg" ? "jpg" : "webp"}`,
      contentType: MEDIA_FORMAT_MIME[variant.format],
    };
  } catch {
    return null;
  }
}
