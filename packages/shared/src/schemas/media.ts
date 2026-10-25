import { z } from "zod";

/*
 * Public media library (Phase 4, WP2). The browser asks for a presigned PUT into the staging prefix
 * of the PUBLIC media bucket, uploads, then commits; the worker validates and re-encodes the image
 * into content-addressed variants. The private uploads bucket is never involved.
 */

export const MEDIA_MIMES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type MediaMime = (typeof MEDIA_MIMES)[number];

export const MEDIA_STATUSES = ["staged", "processing", "ready", "rejected"] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** Rights basis of an image; surfaced as a caption credit and a gate in the content platform. */
export const MEDIA_LICENCES = [
  "own",
  "licensed",
  "cc-by",
  "public-domain",
  "ai-generated",
] as const;
export type MediaLicence = (typeof MEDIA_LICENCES)[number];

export const MEDIA_FORMATS = ["avif", "webp", "jpeg"] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

/** Original upload limit: 15 MB. */
export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
/** Decompression-bomb guard for the worker, in pixels. */
export const MEDIA_MAX_PIXELS = 40_000_000;
/** Presigned PUT lifetime. */
export const MEDIA_UPLOAD_TTL_SECONDS = 600;
/** Variant widths; a width above the original's is skipped (never upscaled). */
export const MEDIA_VARIANT_WIDTHS = [320, 480, 640, 960, 1280, 1600] as const;

export const MEDIA_SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Every key of a published variant starts with this; the staging prefix never does. */
export const MEDIA_KEY_PREFIX = "media/";
export const MEDIA_STAGING_PREFIX = "staging/";

export const MEDIA_FORMAT_EXTENSION = { avif: "avif", webp: "webp", jpeg: "jpg" } as const;
export const MEDIA_FORMAT_MIME = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
} as const;

/** `media/<sha256>/<width>.<ext>`: content-addressed, so the object never changes. */
export function mediaVariantKey(sha256: string, width: number, format: MediaFormat): string {
  return `${MEDIA_KEY_PREFIX}${sha256}/${String(width)}.${MEDIA_FORMAT_EXTENSION[format]}`;
}

export function mediaStagingKey(id: string): string {
  return `${MEDIA_STAGING_PREFIX}${id}`;
}

export const mediaVariantSchema = z.object({
  format: z.enum(MEDIA_FORMATS),
  width: z.number().int().positive(),
  key: z.string().min(1),
  bytes: z.number().int().positive(),
});
export type MediaVariant = z.infer<typeof mediaVariantSchema>;

const focal = z.number().int().min(0).max(100);
const alt = z.string().trim().max(300);

/** `POST /admin/media/uploads` */
export const createMediaUploadSchema = z.object({
  mime: z.enum(MEDIA_MIMES),
  bytes: z.number().int().min(1).max(MEDIA_MAX_BYTES),
  sha256: z.string().regex(MEDIA_SHA256_PATTERN),
});
export type CreateMediaUploadInput = z.infer<typeof createMediaUploadSchema>;

/** `PATCH /admin/media/:id` */
export const patchMediaSchema = z
  .object({
    altAr: alt.nullable(),
    altEn: alt.nullable(),
    focalX: focal,
    focalY: focal,
    caption: z.string().trim().max(300).nullable(),
    credit: z.string().trim().max(200).nullable(),
    licence: z.enum(MEDIA_LICENCES),
    licenceRef: z.string().trim().max(300).nullable(),
    /** Lower-case ASCII words joined by hyphens, without extension: the SEO file name. */
    seoFilename: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lower-case ascii words joined by hyphens")
      .nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to change" });
export type PatchMediaInput = z.infer<typeof patchMediaSchema>;

export const mediaIdParamSchema = z.object({ id: z.uuid() });

export const listMediaQuerySchema = z.object({
  status: z.enum(MEDIA_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

export const mediaAssetSchema = z.object({
  id: z.uuid(),
  sha256: z.string(),
  status: z.enum(MEDIA_STATUSES),
  mime: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int().nullable(),
  focalX: z.number().int(),
  focalY: z.number().int(),
  altAr: z.string().nullable(),
  altEn: z.string().nullable(),
  blurDataUrl: z.string().nullable(),
  variants: z.array(mediaVariantSchema),
  rejectReason: z.string().nullable(),
  originalFilename: z.string().nullable(),
  seoFilename: z.string().nullable(),
  caption: z.string().nullable(),
  credit: z.string().nullable(),
  licence: z.enum(MEDIA_LICENCES),
  licenceRef: z.string().nullable(),
  /** Problems the worker found while processing (read-only), e.g. `avif_over_budget_1600`. */
  warnings: z.array(z.string()),
  /** Items that use the asset (`content_media_refs`); 0 when unused. */
  usageCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

/** `GET /admin/media/:id/usage`: where an asset is used. */
export const mediaUsageResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      type: z.enum(["article", "guide", "glossary", "page"]),
      title: z.string(),
      role: z.enum(["featured", "body", "og", "photo"]),
    }),
  ),
});
export type MediaUsageResponse = z.infer<typeof mediaUsageResponseSchema>;

/** What `<ContentImage>` needs from an asset. */
export type ContentImageAsset = Pick<
  MediaAsset,
  "width" | "height" | "focalX" | "focalY" | "blurDataUrl" | "variants"
>;

export const mediaUploadResponseSchema = z.object({
  asset: mediaAssetSchema,
  /** Absent when the same image is already `ready` (dedupe): nothing to upload. */
  upload: z
    .object({
      url: z.string(),
      headers: z.record(z.string(), z.string()),
      expiresInSeconds: z.number().int(),
    })
    .optional(),
});
export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>;

export const mediaListResponseSchema = z.object({
  items: z.array(mediaAssetSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;

/** Reasons the worker records in `reject_reason`. */
export const MEDIA_REJECT_REASONS = [
  "upload_missing",
  "unsupported_type",
  "type_mismatch",
  "too_many_pixels",
  "unreadable",
  "hash_mismatch",
] as const;
export type MediaRejectReason = (typeof MEDIA_REJECT_REASONS)[number];
