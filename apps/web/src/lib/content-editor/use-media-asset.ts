"use client";

import { mediaAssetSchema } from "@wasfa/shared/schemas/media";

import { useResource, type ResourceHandle } from "../use-admin-data";

import type { MediaAsset } from "@wasfa/shared/schemas/media";

/** `GET /admin/media/:id` for the featured / OG image cards; `null` loads nothing. */
export function useMediaAsset(id: string | null): ResourceHandle<MediaAsset> {
  return useResource(id === null ? null : `/admin/media/${id}`, mediaAssetSchema);
}
