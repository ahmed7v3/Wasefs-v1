import { createHash } from "node:crypto";

import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { MEDIA_MAX_BYTES, type MediaMime } from "@wasfa/shared/schemas/media";

/*
 * Media gate of the Publishing API: what the BYTES are decides, never the filename or the declared
 * content type. JPEG, PNG, WebP and AVIF are accepted (what the media worker can process); animated
 * images, SVG, HEIC, PDFs and everything else are refused with UNSUPPORTED_MEDIA. A static GIF is on the
 * spec's list but the media pipeline has no GIF support yet, so it is refused with its own reason.
 */

/** Publishing API cap per file (docs/PUBLISHING-API.md §5): 10 MB, below the library's own 15 MB. */
export const PUBLISH_MEDIA_MAX_BYTES = Math.min(10 * 1024 * 1024, MEDIA_MAX_BYTES);

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const ascii = (bytes: Buffer, start: number, end: number): string =>
  bytes.subarray(start, end).toString("latin1");

/** PNG: an `acTL` chunk before the first `IDAT` marks an animated PNG. */
function isAnimatedPng(bytes: Buffer): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = ascii(bytes, offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    offset += 12 + length;
  }
  return false;
}

/** WebP: the VP8X animation flag (bit 1 of the flags byte). */
function isAnimatedWebp(bytes: Buffer): boolean {
  return ascii(bytes, 12, 16) === "VP8X" && ((bytes[20] ?? 0) & 0x02) !== 0;
}

export type SniffResult =
  | { ok: true; mime: MediaMime }
  | { ok: false; reason: "unrecognised" | "animated" | "gif_not_supported" | "empty" };

export function sniffImage(bytes: Buffer): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mime: "image/jpeg" };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return isAnimatedPng(bytes)
      ? { ok: false, reason: "animated" }
      : { ok: true, mime: "image/png" };
  }
  if (bytes.length >= 21 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return isAnimatedWebp(bytes)
      ? { ok: false, reason: "animated" }
      : { ok: true, mime: "image/webp" };
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "avif") return { ok: true, mime: "image/avif" };
    if (brand === "avis") return { ok: false, reason: "animated" };
  }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) {
    return { ok: false, reason: "gif_not_supported" };
  }
  return { ok: false, reason: "unrecognised" };
}

/** Size and type checks in one place: PAYLOAD_TOO_LARGE (413) before UNSUPPORTED_MEDIA (415). */
export function assertAcceptableImage(bytes: Buffer): { mime: MediaMime; sha256: string } {
  if (bytes.length > PUBLISH_MEDIA_MAX_BYTES) throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE);
  const verdict = sniffImage(bytes);
  if (!verdict.ok) {
    throw new AppError(ErrorCode.UNSUPPORTED_MEDIA, { details: { reason: verdict.reason } });
  }
  return { mime: verdict.mime, sha256: sha256Hex(bytes) };
}
