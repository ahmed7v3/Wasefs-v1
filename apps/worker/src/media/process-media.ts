import {
  MEDIA_MAX_PIXELS,
  MEDIA_MIMES,
  MEDIA_VARIANT_WIDTHS,
  type MediaFormat,
} from "@wasfa/shared/schemas/media";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata } from "sharp";

import { MediaRejected } from "./rejected.js";

/** Starting encoder quality per format (CONTENT-PLATFORM §5.3); AVIF may step down to meet its budget. */
export const MEDIA_QUALITY = { avif: 50, webp: 72, jpeg: 75 } as const;
/** CONTENT-PLATFORM §5.3: a 1600 px AVIF article image is at most 180 KB. Applies to that width only. */
export const MEDIA_AVIF_BUDGET_BYTES = 180_000;
const AVIF_BUDGET_WIDTH = 1600;
const AVIF_QUALITY_FLOOR = 30;
const AVIF_QUALITY_STEP = 5;
const BLUR_WIDTH = 16;

const ACCEPTED = new Set<string>(MEDIA_MIMES);

export interface ProcessedVariant {
  format: MediaFormat;
  width: number;
  body: Buffer;
}

export interface ProcessedMedia {
  /** The type found in the bytes (equal to the declared one, or the file was rejected). */
  mime: (typeof MEDIA_MIMES)[number];
  /** Size after the EXIF orientation is applied. */
  width: number;
  height: number;
  blurDataUrl: string;
  variants: ProcessedVariant[];
  /** Empty normally; `"avif_over_budget_1600"` when even the quality floor misses the AVIF budget. */
  warnings: string[];
}

/**
 * Encodes at `start`, then lowers quality by `step` until the result fits `budget` or `floor` is
 * reached. Returns the first fitting result, or the floor result with `withinBudget: false`.
 */
export async function encodeWithinBudget(
  encodeAt: (quality: number) => Promise<Buffer>,
  budget: number,
  start: number,
  floor: number,
  step: number,
): Promise<{ body: Buffer; quality: number; withinBudget: boolean }> {
  let quality = start;
  let body = await encodeAt(quality);
  while (body.byteLength > budget && quality > floor) {
    quality = Math.max(floor, quality - step);
    body = await encodeAt(quality);
  }
  return { body, quality, withinBudget: body.byteLength <= budget };
}

// Decoded pixels are not worth keeping around between jobs; memory is the scarce resource here.
sharp.cache(false);

const decode = (input: Buffer) =>
  // `failOn: "error"` also refuses truncated files. SVG and HEIC never get here (magic bytes).
  sharp(input, { limitInputPixels: MEDIA_MAX_PIXELS, failOn: "error" });

/**
 * Turns an uploaded original into the public variants. Order matters: the bytes must really be
 * what was declared (magic bytes, not the browser's word; SVG, HEIC and GIF are not accepted), the
 * pixel count is checked from the header before any decode, then every variant is decoded fresh,
 * oriented, converted to sRGB and re-encoded WITHOUT metadata (no `withMetadata`/`keepExif`, so
 * EXIF, XMP, IPTC and GPS are gone). Widths above the original's are skipped, never upscaled.
 * Throws `MediaRejected` for an unacceptable file; any other error is infrastructure and retried.
 */
export async function processMedia(input: Buffer, declaredMime: string): Promise<ProcessedMedia> {
  const detected = await fileTypeFromBuffer(input);
  if (detected === undefined || !ACCEPTED.has(detected.mime)) {
    throw new MediaRejected("unsupported_type");
  }
  if (detected.mime !== declaredMime) throw new MediaRejected("type_mismatch");
  const mime = detected.mime as ProcessedMedia["mime"];

  let meta: Metadata;
  try {
    meta = await decode(input).metadata();
  } catch (error) {
    throw new MediaRejected(rejectReasonOf(error));
  }
  if (meta.width === undefined || meta.height === undefined) throw new MediaRejected("unreadable");
  // Orientations 5-8 are rotated by 90 degrees: width and height swap.
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = swapped ? meta.height : meta.width;
  const height = swapped ? meta.width : meta.height;
  if (width * height > MEDIA_MAX_PIXELS) throw new MediaRejected("too_many_pixels");

  try {
    const fitting = MEDIA_VARIANT_WIDTHS.filter((candidate) => candidate <= width);
    const widths = fitting.length > 0 ? fitting : [width];
    const variants: ProcessedVariant[] = [];
    const warnings: string[] = [];
    for (const target of widths) {
      for (const format of ["avif", "webp", "jpeg"] as const) {
        if (format === "avif" && target === AVIF_BUDGET_WIDTH) {
          const fitted = await encodeWithinBudget(
            (quality) => encode(input, target, "avif", quality),
            MEDIA_AVIF_BUDGET_BYTES,
            MEDIA_QUALITY.avif,
            AVIF_QUALITY_FLOOR,
            AVIF_QUALITY_STEP,
          );
          if (!fitted.withinBudget) warnings.push("avif_over_budget_1600");
          variants.push({ format, width: target, body: fitted.body });
        } else {
          variants.push({ format, width: target, body: await encode(input, target, format) });
        }
      }
    }
    const blur = await decode(input)
      .rotate()
      .resize({ width: BLUR_WIDTH, withoutEnlargement: true })
      .toColourspace("srgb")
      .webp({ quality: 40 })
      .toBuffer();
    return {
      mime,
      width,
      height,
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
      variants,
      warnings,
    };
  } catch (error) {
    // The header was fine but the pixels are not: decoding the same bytes again would fail the same way.
    throw new MediaRejected(rejectReasonOf(error));
  }
}

/** sharp reports the pixel limit in its message; any other decode failure means a broken file. */
function rejectReasonOf(error: unknown): "too_many_pixels" | "unreadable" {
  return error instanceof Error && /pixel limit/i.test(error.message)
    ? "too_many_pixels"
    : "unreadable";
}

async function encode(
  input: Buffer,
  width: number,
  format: MediaFormat,
  avifQuality: number = MEDIA_QUALITY.avif,
): Promise<Buffer> {
  let pipeline = decode(input)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .toColourspace("srgb");
  if (format === "jpeg") {
    // JPEG has no alpha: transparency lands on white.
    pipeline = pipeline.flatten({ background: "#ffffff" });
    return pipeline.jpeg({ quality: MEDIA_QUALITY.jpeg, mozjpeg: true }).toBuffer();
  }
  return format === "avif"
    ? pipeline.avif({ quality: avifQuality }).toBuffer()
    : pipeline.webp({ quality: MEDIA_QUALITY.webp }).toBuffer();
}
