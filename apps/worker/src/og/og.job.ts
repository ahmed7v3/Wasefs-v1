import { mediaVariantKey } from "@wasfa/shared/schemas/media";
import { ogCardKey, type OgImage, type OgRenderPayload } from "@wasfa/shared/schemas/og";

import { MEDIA_CACHE_CONTROL } from "../media/media.job.js";

import { OG_MAX_BYTES, OG_RENDERERS, OG_TEMPLATES, ogCardHash } from "./render.js";

import type { JobContext } from "../queues.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { OgAssets } from "./templates/index.js";

type OgContext = Pick<JobContext, "logger" | "media">;

/** Widest first: the card draws a 420 px panel at most, so any of these is sharp enough. */
const IMAGE_VARIANT_WIDTHS = [960, 640, 320] as const;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

async function loadImage(media: ObjectStore, image: OgImage): Promise<Buffer> {
  for (const width of IMAGE_VARIANT_WIDTHS) {
    const bytes = await media.get(mediaVariantKey(image.sha256, width, "jpeg"), IMAGE_MAX_BYTES);
    if (bytes !== null) return bytes;
  }
  // Retried by the queue: the asset's variants may still be processing.
  throw new Error("OG card image has no JPEG variant in the media bucket");
}

/**
 * Renders one card into the public media bucket at `og/<template>/<hash>.png` unless that object
 * is already there (the hash covers template version, input and assets, so equal means identical).
 * Returns the key; `created` is false when the card was already stored.
 */
export async function renderAndStoreOgCard(
  media: ObjectStore,
  payload: OgRenderPayload,
): Promise<{ key: string; created: boolean }> {
  const template = OG_TEMPLATES[payload.template];
  const input = template.schema.parse(payload.input);
  const key = ogCardKey(payload.template, ogCardHash(template, input));
  if ((await media.get(key, OG_MAX_BYTES * 4)) !== null) return { key, created: false };

  const assets: OgAssets = {};
  if (payload.template === "article" && payload.input.cover !== undefined) {
    assets.cover = await loadImage(media, payload.input.cover);
  }
  if (payload.template === "author" && payload.input.photo !== undefined) {
    assets.photo = await loadImage(media, payload.input.photo);
  }
  const { png, hash } = await OG_RENDERERS[payload.template](payload.input, assets);
  // Same inputs and assets as the key above; a mismatch would mean the card changed under us.
  if (ogCardKey(payload.template, hash) !== key)
    throw new Error("OG card hash changed while rendering");
  await media.put(key, png, "image/png", MEDIA_CACHE_CONTROL);
  return { key, created: true };
}

/** `og.render`: one generated Open Graph / X card. Logs the key and template only, never the input. */
export async function ogRenderJob(
  payload: OgRenderPayload,
  { logger, media }: OgContext,
): Promise<void> {
  if (media === undefined) {
    throw new Error(
      "Media storage is not configured (R2_MEDIA_BUCKET and R2_UPLOADS_* are not set)",
    );
  }
  const { key, created } = await renderAndStoreOgCard(media, payload);
  logger.info({ template: payload.template, key, created }, "OG card rendered");
}
