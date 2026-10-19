import {
  MEDIA_MAX_PIXELS,
  MEDIA_MIMES,
  MEDIA_VARIANT_WIDTHS,
  type MediaFormat,
} from "@wasfa/shared/schemas/media";
import { fileTypeFromBuffer } from "file-type";
import sharp, { type Metadata } from "sharp";

import { MediaRejected } from "./rejected.js";

/** Encoder settings per format (BRAND/CONTENT-PLATFORM §5.3 budgets are checked by the worker tests). */
export const MEDIA_QUALITY = { avif: 50, webp: 70, jpeg: 75 } as const;
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
    for (const target of widths) {
      for (const format of ["avif", "webp", "jpeg"] as const) {
        variants.push({ format, width: target, body: await encode(input, target, format) });
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

async function encode(input: Buffer, width: number, format: MediaFormat): Promise<Buffer> {
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
    ? pipeline.avif({ quality: MEDIA_QUALITY.avif }).toBuffer()
    : pipeline.webp({ quality: MEDIA_QUALITY.webp }).toBuffer();
}
