import { z } from "zod";

/*
 * Object storage for uploads (Cloudflare R2 in production, MinIO locally and in tests). The api
 * presigns and checks, the worker reads, processes and deletes; both read the same env keys, so
 * the shape lives here.
 */

/** Blank values (`KEY=` in a compose file) count as "not set". */
const blankAsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const uploadsEnvShape = {
  /** `https://<account>.r2.cloudflarestorage.com`, or the MinIO URL locally. */
  R2_UPLOADS_ENDPOINT: blankAsUnset(z.url({ protocol: /^https?$/ })),
  R2_UPLOADS_BUCKET: blankAsUnset(z.string().min(3).max(63)),
  R2_UPLOADS_ACCESS_KEY_ID: blankAsUnset(z.string().min(1)),
  R2_UPLOADS_SECRET_ACCESS_KEY: blankAsUnset(z.string().min(1)),
  /** R2 uses `auto`. */
  R2_UPLOADS_REGION: z.string().min(1).default("auto"),
};

interface UploadsEnv {
  R2_UPLOADS_ENDPOINT?: string | undefined;
  R2_UPLOADS_BUCKET?: string | undefined;
  R2_UPLOADS_ACCESS_KEY_ID?: string | undefined;
  R2_UPLOADS_SECRET_ACCESS_KEY?: string | undefined;
  R2_UPLOADS_REGION: string;
}

const REQUIRED_TOGETHER = [
  "R2_UPLOADS_ENDPOINT",
  "R2_UPLOADS_BUCKET",
  "R2_UPLOADS_ACCESS_KEY_ID",
  "R2_UPLOADS_SECRET_ACCESS_KEY",
] as const;

/** All four storage keys or none: half a configuration can only be a mistake. */
export function refineUploadsEnv(env: UploadsEnv, ctx: z.RefinementCtx): void {
  const missing = REQUIRED_TOGETHER.filter((key) => env[key] === undefined);
  if (missing.length === 0 || missing.length === REQUIRED_TOGETHER.length) return;
  for (const key of missing) {
    ctx.addIssue({
      code: "custom",
      path: [key],
      message: "must be set together with the other R2_UPLOADS_* keys",
    });
  }
}

export interface UploadsStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/** The storage configuration, or `undefined` when uploads are not configured (uploads then answer 503). */
export function uploadsStorageConfig(env: UploadsEnv): UploadsStorageConfig | undefined {
  const { R2_UPLOADS_ENDPOINT: endpoint, R2_UPLOADS_BUCKET: bucket } = env;
  const { R2_UPLOADS_ACCESS_KEY_ID: accessKeyId, R2_UPLOADS_SECRET_ACCESS_KEY: secretAccessKey } =
    env;
  if (
    endpoint === undefined ||
    bucket === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    return undefined;
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: env.R2_UPLOADS_REGION };
}

/** Key of the uploaded bytes. `ownerId` is the user or organization id. PDFs keep their extension so the type survives in the key. */
export function originalObjectKey(ownerId: string, fileId: string, isPdf: boolean): string {
  return `u/${ownerId}/${fileId}/original${isPdf ? ".pdf" : ""}`;
}

/** Key of the re-encoded JPEG the AI and the user's screens read. */
export function processedObjectKey(ownerId: string, fileId: string): string {
  return `u/${ownerId}/${fileId}/processed`;
}

/** True for the key of an uploaded PDF (`originalObjectKey(..., true)`). */
export function isPdfObjectKey(key: string): boolean {
  return key.endsWith("/original.pdf");
}
