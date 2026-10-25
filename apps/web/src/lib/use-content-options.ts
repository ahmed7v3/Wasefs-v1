"use client";

import { contentOptionsSchema } from "@wasfa/shared/schemas/content";

import { useResource, type ResourceHandle } from "./use-admin-data";

import type { ContentOptions } from "@wasfa/shared/schemas/content";

/** Compact categories, tags, authors and reviewers for the pickers (`GET /admin/content/options`). */
export function useContentOptions(): ResourceHandle<ContentOptions> {
  return useResource("/admin/content/options", contentOptionsSchema);
}
