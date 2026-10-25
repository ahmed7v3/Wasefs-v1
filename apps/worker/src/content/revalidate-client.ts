import { REVALIDATE_HEADER, signRevalidation } from "@wasfa/shared/content/revalidate";
import { REVALIDATE_MAX_TAGS, revalidateRequestSchema } from "@wasfa/shared/schemas/content";

import type { Logger } from "pino";

export const REVALIDATE_TIMEOUT_MS = 5_000;

/** `tags` split into requests the web accepts (`REVALIDATE_MAX_TAGS` each). */
export function chunkTags(tags: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let start = 0; start < tags.length; start += REVALIDATE_MAX_TAGS) {
    chunks.push(tags.slice(start, start + REVALIDATE_MAX_TAGS));
  }
  return chunks;
}

export type RevalidateResult = "sent" | "skipped";

/**
 * Purges web cache tags (`POST {WEB_INTERNAL_URL}/api/revalidate`, HMAC-signed). Either setting
 * unset = feature off (dev): one info log, nothing sent. 2xx is done; 404 means the web has no
 * secret either, so it is logged and treated as done; anything else (including a network error or
 * timeout) throws so the outbox retries with backoff.
 */
export async function revalidateTags(input: {
  webInternalUrl: string | undefined;
  secret: string | undefined;
  tags: readonly string[];
  logger: Pick<Logger, "info" | "warn">;
  fetchImpl?: typeof fetch;
  /** Unix seconds; injectable for tests. */
  nowSeconds?: () => number;
}): Promise<RevalidateResult> {
  const { webInternalUrl, secret, tags, logger } = input;
  if (webInternalUrl === undefined || secret === undefined) {
    logger.info("WEB_INTERNAL_URL or REVALIDATE_SECRET is not set; web cache purge skipped");
    return "skipped";
  }
  const send = input.fetchImpl ?? fetch;
  const endpoint = new URL("/api/revalidate", webInternalUrl).toString();
  for (const chunk of chunkTags(tags)) {
    const timestamp = (input.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
    const body = JSON.stringify(revalidateRequestSchema.parse({ tags: chunk, timestamp }));
    const response = await send(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [REVALIDATE_HEADER]: signRevalidation(secret, timestamp, body),
      },
      body,
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
    if (response.ok) continue;
    if (response.status === 404) {
      logger.warn("The web app has no REVALIDATE_SECRET (404); cache purge treated as done");
      continue;
    }
    throw new Error(`Web revalidate answered ${String(response.status)}`);
  }
  return "sent";
}
