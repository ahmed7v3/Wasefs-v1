import { type MediaAsset, type MediaVariant } from "@wasfa/shared/schemas/media";

import { precheckFile, uploadMediaFile } from "./media-upload-client";

/*
 * Promise-style upload for callers that only want the finished asset (the content editor's pasted and
 * dropped images), plus the small display helpers for library thumbnails. The flow itself (hash, presigned
 * PUT, commit, poll) lives once, in `media-upload-client.ts`; this file only maps its end state to a
 * thrown `MediaUploadError`.
 */

/** Smallest ready variant of an asset (WebP preferred), for grid thumbnails; null while it has none. */
export function thumbnailKey(asset: { variants: readonly MediaVariant[] }): string | null {
  const byWidth = [...asset.variants].sort((a, b) => a.width - b.width);
  return (byWidth.find((variant) => variant.format === "webp") ?? byWidth[0])?.key ?? null;
}

/** Public URL of a published media object; null while no media origin is configured. */
export function mediaObjectUrl(key: string, origin: string | undefined): string | null {
  return origin ? `${origin.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}` : null;
}

export type MediaUploadFailure =
  "unsupported_type" | "too_large" | "upload_failed" | "rejected" | "timeout";

export class MediaUploadError extends Error {
  constructor(
    readonly reason: MediaUploadFailure,
    /** The worker's reject reason (`too_many_pixels`, ...) when the image was refused. */
    readonly detail?: string,
  ) {
    super(`media upload failed: ${reason}`);
    this.name = "MediaUploadError";
  }
}

export interface UploadOptions {
  signal?: AbortSignal | undefined;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** Uploads one image and resolves with the `ready` asset; throws `MediaUploadError` otherwise. */
export async function uploadMedia(file: File, options: UploadOptions = {}): Promise<MediaAsset> {
  const problem = precheckFile(file);
  if (problem === "unsupported_type") throw new MediaUploadError("unsupported_type");
  if (problem !== null) throw new MediaUploadError("too_large");

  const state = await uploadMediaFile(file, {
    onPhase: () => undefined,
    poll: {
      ...(options.pollIntervalMs === undefined ? {} : { intervalMs: options.pollIntervalMs }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      signal: options.signal,
    },
  });

  switch (state.phase) {
    case "ready":
      if (state.asset) return state.asset;
      throw new MediaUploadError("upload_failed");
    case "rejected":
      throw new MediaUploadError("rejected", state.asset?.rejectReason ?? undefined);
    case "timeout":
      throw new MediaUploadError("timeout");
    default:
      throw new MediaUploadError("upload_failed");
  }
}
