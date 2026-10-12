import { createHash } from "node:crypto";

import { PROCESSED_LONG_EDGE, isHeicMime } from "@wasfa/shared/schemas/files";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { rasterizePdf } from "./pdf.js";
import { ImageRejected } from "./rejected.js";

/** Decompression-bomb guard: a 20,000 x 20,000 PNG is a few KB on the wire and 1.2 GB decoded. */
export const MAX_INPUT_PIXELS = 40_000_000;
export const JPEG_QUALITY = 88;

/** Types the worker decodes. HEIC is not among them: the browser converts it (Task 2.6). */
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
  if (isHeicMime(detected.mime)) throw new ImageRejected("heic_unsupported");
  if (!DECODABLE.has(detected.mime)) throw new ImageRejected("unsupported_type");
  if (detected.mime !== declaredMime) throw new ImageRejected("type_mismatch");

  const raster = detected.mime === "application/pdf" ? await rasterizePdf(input) : input;
  try {
    const { data, info } = await sharp(raster, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    })
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
