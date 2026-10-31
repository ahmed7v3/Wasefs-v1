import { createHash } from "node:crypto";

import { PROCESSED_LONG_EDGE, isHeicMime } from "@wasfa/shared/schemas/files";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { decodeHeic } from "./heic.js";
import { rasterizePdf } from "./pdf.js";
import { ImageRejected } from "./rejected.js";

/** Decompression-bomb guard: a 20,000 x 20,000 PNG is a few KB on the wire and 1.2 GB decoded. */
export const MAX_INPUT_PIXELS = 40_000_000;
export const JPEG_QUALITY = 88;

/**
 * Types sharp decodes directly. HEIC/HEIF is decoded to raw pixels first (`decodeHeic`, WASM in a
 * worker thread): sharp's prebuilt binaries cannot read it (patents).
 */
const DECODABLE = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export interface ProcessedImage {
  jpeg: Buffer;
  width: number;
  height: number;
  /** Lower-case hex SHA-256 of `jpeg`. */
  sha256: string;
  /** 64-bit difference hash of `jpeg`, 16 lower-case hex characters. */
  dhash: string;
}

// Decoded pixels are not worth keeping around between jobs; memory is the scarce resource here.
sharp.cache(false);

/**
 * Turns an uploaded file into the one image the rest of the product sees:
 * 1. the bytes must really be what was declared (magic bytes, not the browser's word);
 * 2. decode with a pixel limit, apply the EXIF orientation, drop all metadata (GPS included);
 * 3. flatten transparency onto white, scale the long edge to 2048 px (never up), JPEG q88.
 * Anything appended to a valid image (a polyglot's zip or HTML) does not survive the re-encode.
 * Throws `ImageRejected` for a file that is not acceptable; any other error is infrastructure.
 */
export async function processImage(input: Buffer, declaredMime: string): Promise<ProcessedImage> {
  const detected = await fileTypeFromBuffer(input);
  if (detected === undefined) throw new ImageRejected("unsupported_type");
  // The browser path refuses HEIC at upload time; one that arrives here came from a server-side
  // import (WhatsApp) whose row can only declare a FileMime, so the declared type is not compared.
  const heic = isHeicMime(detected.mime);
  if (!heic && !DECODABLE.has(detected.mime)) throw new ImageRejected("unsupported_type");
  if (!heic && detected.mime !== declaredMime) throw new ImageRejected("type_mismatch");

  const decoded = heic ? await decodeHeic(input, MAX_INPUT_PIXELS) : null;
  const raster = detected.mime === "application/pdf" ? await rasterizePdf(input) : input;
  try {
    const { data, info } = await sharp(decoded === null ? raster : decoded.data, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
      ...(decoded === null
        ? {}
        : { raw: { width: decoded.width, height: decoded.height, channels: 4 as const } }),
    })
      // Raw pixels carry no EXIF orientation, so for HEIC this is a no-op (libheif applies it).
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({
        width: PROCESSED_LONG_EDGE,
        height: PROCESSED_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      // No `withMetadata`/`keepExif`: sharp then writes none of the input's EXIF, XMP or IPTC.
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return {
      jpeg: data,
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(data).digest("hex"),
      dhash: await differenceHash(data),
    };
  } catch (error) {
    throw new ImageRejected(
      error instanceof Error && /pixel limit/i.test(error.message)
        ? "too_many_pixels"
        : "corrupt_image",
    );
  }
}

/**
 * dHash: shrink to 9 x 8 grey pixels and record, row by row, whether each pixel is brighter than
 * its right neighbour. 64 bits, stable under rescaling and re-compression; the Hamming distance
 * between two hashes measures how alike two photos of the same paper are.
 */
export async function differenceHash(image: Buffer): Promise<string> {
  const { data } = await sharp(image)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      const left = data[row * 9 + column] ?? 0;
      const right = data[row * 9 + column + 1] ?? 0;
      bits += left > right ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}
