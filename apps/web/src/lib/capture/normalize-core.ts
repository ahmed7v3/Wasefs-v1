import { PROCESSED_LONG_EDGE } from "@wasfa/shared/schemas/files";

import { QUALITY_SAMPLE_EDGE, assessQuality, fitLongEdge } from "./quality";

import type { PreparedImage } from "@wasfa/ui";

/*
 * The browser-side image pipeline of Task 2.6: decode (EXIF upright), resize to a 2048 px long
 * edge, JPEG q0.85, quality check, SHA-256. It runs inside a Worker when the browser has
 * OffscreenCanvas (`normalize.worker.ts`) and on the main thread otherwise (`normalize-image.ts`),
 * so it may use only APIs that exist in both places, plus `document` strictly as the fallback.
 */

export const JPEG_QUALITY = 0.85;
/** Pixels a decoded picture may have before we refuse to draw it (a decompression bomb guard). */
const MAX_DECODED_PIXELS = 150_000_000;

/** The file is not an image this browser can read. */
export class ImageDecodeError extends Error {
  constructor(message = "cannot decode image") {
    super(message);
    this.name = "ImageDecodeError";
  }
}

type Surface = OffscreenCanvas | HTMLCanvasElement;
type Context = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  // Browsers without OffscreenCanvas only run this on the main thread, where `document` exists.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(surface: Surface): Context {
  // Narrowed first: calling `getContext` on the union picks the generic overload in some setups.
  const ctx: Context | null =
    "convertToBlob" in surface ? surface.getContext("2d") : surface.getContext("2d");
  if (!ctx) throw new Error("2d canvas is not available");
  return ctx;
}

function encodeJpeg(surface: Surface): Promise<Blob> {
  if ("convertToBlob" in surface) {
    return surface.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  }
  return new Promise((resolve, reject) => {
    surface.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("canvas could not encode JPEG"));
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/** Lower-case hex SHA-256 of a blob (the API checks it against what R2 received). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function drawWhite(ctx: Context, width: number, height: number): void {
  // JPEG has no alpha: a transparent PNG would otherwise turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
}

export async function normalizeBlob(source: Blob): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    throw new ImageDecodeError();
  }
  try {
    if (bitmap.width * bitmap.height > MAX_DECODED_PIXELS) throw new ImageDecodeError();

    const target = fitLongEdge(bitmap.width, bitmap.height, PROCESSED_LONG_EDGE);
    const surface = createSurface(target.width, target.height);
    const ctx = context(surface);
    drawWhite(ctx, target.width, target.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await encodeJpeg(surface);

    // The quality check looks at a small grayscale-able copy, never at the full picture.
    const sampleSize = fitLongEdge(target.width, target.height, QUALITY_SAMPLE_EDGE);
    const sampleSurface = createSurface(sampleSize.width, sampleSize.height);
    const sampleCtx = context(sampleSurface);
    drawWhite(sampleCtx, sampleSize.width, sampleSize.height);
    sampleCtx.imageSmoothingQuality = "medium";
    sampleCtx.drawImage(bitmap, 0, 0, sampleSize.width, sampleSize.height);
    const sample = sampleCtx.getImageData(0, 0, sampleSize.width, sampleSize.height);

    return {
      blob,
      width: target.width,
      height: target.height,
      sha256: await sha256Hex(blob),
      issues: assessQuality(Math.max(target.width, target.height), {
        data: sample.data,
        width: sample.width,
        height: sample.height,
      }),
    };
  } finally {
    bitmap.close();
  }
}
