import { readSetting } from "../settings.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const TIMEOUT_MS = 10_000;

/**
 * Announces changed URLs to IndexNow (SEO-GEO §10.4). Off until the owner enables it and sets a key.
 * 200/202 are success; 429 and 5xx throw so BullMQ retries with backoff; any other 4xx (bad key,
 * unverifiable key file) is logged and dropped, because retrying cannot fix it.
 */
export async function indexNowJob(
  payload: JobPayload<"seo", "seo.indexnow">,
  { db, logger, env }: Pick<JobContext, "db" | "logger" | "env">,
): Promise<void> {
  const { indexNow } = await readSetting(db, "seo");
  if (!indexNow.enabled || indexNow.key === null) {
    logger.info("IndexNow is disabled or has no key; skipping");
    return;
  }
  const siteUrl = new URL(env?.WEB_ORIGIN ?? "http://localhost:3000");
  const urlList = payload.urls.filter((url) => new URL(url).host === siteUrl.host);
  if (urlList.length < payload.urls.length) {
    logger.warn(
      { dropped: payload.urls.length - urlList.length },
      "IndexNow URLs on another host were dropped",
    );
  }
  if (urlList.length === 0) return;

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: siteUrl.host,
      key: indexNow.key,
      keyLocation: `${siteUrl.origin}/indexnow.txt`,
      urlList,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 200 || response.status === 202) {
    logger.info({ count: urlList.length }, "IndexNow accepted the URLs");
    return;
  }
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`IndexNow answered ${String(response.status)}`);
  }
  logger.warn({ status: response.status }, "IndexNow rejected the request; not retrying");
}
