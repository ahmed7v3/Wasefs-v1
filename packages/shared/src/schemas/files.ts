import { z } from "zod";

import { FILE_PURPOSES, FILE_SHA256_PATTERN, type FileMime } from "../ai.js";

/*
 * Uploads contract (Phase 2, Task 2.5): the browser asks for a presigned PUT, uploads straight to
 * R2, then tells the API it is done. The API never touches the bytes.
 */

/** What the browser may send. PDFs are rasterized by the worker; the stored result is always a JPEG. */
export const UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type UploadMime = (typeof UPLOAD_MIMES)[number];

/**
 * Types the browser converts before uploading (Task 2.6). sharp's prebuilt binaries cannot decode
 * HEIC (patents), so one that reaches the server is refused with `heic_unsupported`.
 */
export const HEIC_MIMES = [
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
] as const;

export function isHeicMime(mime: string): boolean {
  return (HEIC_MIMES as readonly string[]).includes(mime);
}

/** 10 MB: the limit users see. The table allows 15 MB so the limit can be raised without a migration. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Presigned PUT lifetime. */
export const UPLOAD_URL_TTL_SECONDS = 300;
/** Presigned GET lifetime for viewing an image. */
export const FILE_URL_TTL_SECONDS = 60;
/** 30 upload requests per user per 10 minutes. */
export const UPLOAD_RATE_LIMIT = { max: 30, windowSeconds: 600 } as const;

/** Longest edge of the stored image, in pixels (phase2.md, Decision 3: enough for handwriting). */
export const PROCESSED_LONG_EDGE = 2048;
/** Pages of a PDF the worker would rasterize; a file may hold only one page today (see `files.r2_key`). */
export const PDF_MAX_PAGES = 4;

/** Why an upload was refused or rejected; the web app switches on these. */
export const UPLOAD_REJECT_REASONS = [
  "heic_unsupported",
  "unsupported_type",
  "upload_missing",
  "type_mismatch",
  "size_mismatch",
  "too_many_pixels",
  "corrupt_image",
  "pdf_unreadable",
  "pdf_multi_page_unsupported",
] as const;
export type UploadRejectReason = (typeof UPLOAD_REJECT_REASONS)[number];

export const createUploadSchema = z.object({
  purpose: z.enum(FILE_PURPOSES),
  /** HEIC/HEIF pass this schema on purpose: the API answers them with a specific reason. */
  mime: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (mime) => (UPLOAD_MIMES as readonly string[]).includes(mime) || isHeicMime(mime),
      "unsupported type",
    ),
  bytes: z.number().int().min(1).max(UPLOAD_MAX_BYTES),
  /** Lower-case hex SHA-256 of the bytes the browser will upload. */
  sha256: z.string().trim().toLowerCase().regex(FILE_SHA256_PATTERN, "must be 64 hex characters"),
  width: z.number().int().min(1).max(100_000).optional(),
  height: z.number().int().min(1).max(100_000).optional(),
});
export type CreateUploadInput = z.output<typeof createUploadSchema>;

export const createUploadResponseSchema = z.object({
  fileId: z.uuid(),
  /** Presigned PUT. Valid for `UPLOAD_URL_TTL_SECONDS`, for exactly `bytes` bytes of `mime`. */
  url: z.url(),
  /** Headers the PUT must send verbatim (they are part of the signature). */
  headers: z.record(z.string(), z.string()),
  expiresInSeconds: z.number().int().positive(),
});
export type CreateUploadResponse = z.output<typeof createUploadResponseSchema>;

export const completeUploadResponseSchema = z.object({
  fileId: z.uuid(),
  status: z.enum(["uploaded", "processed"]),
});
export type CompleteUploadResponse = z.output<typeof completeUploadResponseSchema>;

export const fileUrlResponseSchema = z.object({
  url: z.url(),
  expiresInSeconds: z.number().int().positive(),
});
export type FileUrlResponse = z.output<typeof fileUrlResponseSchema>;

/** Payload of the `image.process` job. */
export const imageProcessPayloadSchema = z.object({ fileId: z.uuid() });

/** Stored MIME of a processed image: always JPEG, whatever was uploaded. */
export const PROCESSED_MIME: FileMime = "image/jpeg";
