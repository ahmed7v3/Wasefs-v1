import { createHash } from "node:crypto";

import {
  MEDIA_FORMAT_MIME,
  MEDIA_KEY_PREFIX,
  MEDIA_MAX_BYTES,
  mediaVariantKey,
  type MediaVariant,
} from "@wasfa/shared/schemas/media";

import { findAsset, markReady, markRejected } from "./media.repo.js";
import { processMedia } from "./process-media.js";
import { MediaRejected } from "./rejected.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type MediaContext = Pick<JobContext, "db" | "logger" | "media">;

/** Content-addressed keys never change, so the CDN may keep them for a year. */
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * `media.process`: validates and re-encodes one staged original into public variants (Phase 4,
 * WP2). Idempotent: only an asset still `processing` is touched, and variants are written before
 * the row flips to `ready` and before the staging object is deleted, so a crash at any point is
 * repaired by the retry (same keys, same bytes). A bad file is rejected with a reason code; an
 * infrastructure error is thrown and retried by the queue. The staging object is deleted either
 * way. Logs ids and codes only.
 */
export async function mediaProcessJob(
  { assetId }: JobPayload<"images", "media.process">,
  { db, logger, media }: MediaContext,
): Promise<void> {
  if (media === undefined) {
    throw new Error(
      "Media storage is not configured (R2_MEDIA_BUCKET and R2_UPLOADS_* are not set)",
    );
  }
  const asset = await findAsset(db, assetId);
  if (asset === null || asset.status !== "processing" || asset.originalKey === null) {
    logger.info({ assetId, status: asset?.status ?? "missing" }, "Media job skipped");
    return;
  }
  const stagingKey = asset.originalKey;

  const reject = async (reason: string): Promise<void> => {
    await markRejected(db, assetId, reason);
    await media.remove(stagingKey);
    logger.info({ assetId, reason }, "Media rejected");
  };

  const original = await media.get(stagingKey, MEDIA_MAX_BYTES);
  if (original === null) return reject("upload_missing");
  // The presigned PUT already bound this digest; checking again keeps dedupe honest if it ever changes.
  if (createHash("sha256").update(original).digest("hex") !== asset.sha256) {
    return reject("hash_mismatch");
  }

  try {
    const processed = await processMedia(original, asset.mime ?? "");
    const variants: MediaVariant[] = [];
    for (const variant of processed.variants) {
      const key = mediaVariantKey(asset.sha256, variant.width, variant.format);
      // The public bucket only ever receives content under `media/`.
      if (!key.startsWith(MEDIA_KEY_PREFIX)) throw new Error("Media key outside media/");
      await media.put(key, variant.body, MEDIA_FORMAT_MIME[variant.format], MEDIA_CACHE_CONTROL);
      variants.push({
        format: variant.format,
        width: variant.width,
        key,
        bytes: variant.body.byteLength,
      });
    }
    const updated = await markReady(db, assetId, {
      mime: processed.mime,
      width: processed.width,
      height: processed.height,
      bytes: original.byteLength,
      blurDataUrl: processed.blurDataUrl,
      variants,
    });
    if (updated) await media.remove(stagingKey);
    logger.info(
      { assetId, variants: variants.length, warnings: processed.warnings },
      "Media processed",
    );
  } catch (error) {
    if (!(error instanceof MediaRejected)) throw error;
    await reject(error.reason);
  }
}
