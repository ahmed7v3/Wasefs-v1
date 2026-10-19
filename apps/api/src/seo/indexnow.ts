import { INDEXNOW_MAX_URLS, indexNowPayloadSchema, type JobInput } from "@wasfa/shared/queues";

import type { Queue } from "bullmq";

/**
 * Queues an IndexNow ping for changed public URLs (absolute https). Duplicates are dropped and the
 * list is split into jobs of at most `INDEXNOW_MAX_URLS`; the worker skips it while IndexNow is off.
 */
export async function enqueueIndexNow(
  queue: Pick<Queue, "add">,
  urls: readonly string[],
): Promise<void> {
  const unique = [...new Set(urls)];
  for (let start = 0; start < unique.length; start += INDEXNOW_MAX_URLS) {
    const payload: JobInput<"seo", "seo.indexnow"> = indexNowPayloadSchema.parse({
      urls: unique.slice(start, start + INDEXNOW_MAX_URLS),
    });
    await queue.add("seo.indexnow", payload);
  }
}
