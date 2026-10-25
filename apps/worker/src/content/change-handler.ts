import { INDEXNOW_MAX_URLS } from "@wasfa/shared/queues";
import {
  contentChangedPayloadSchema,
  type ContentChangedPayload,
} from "@wasfa/shared/schemas/content";

import { deriveCacheTags } from "./cache-tags.js";
import { findChangedItem, type ChangedItemRow } from "./change-handler.repo.js";
import { revalidateTags } from "./revalidate-client.js";

import type { OutboxHandler } from "@wasfa/db";
import type { Logger } from "pino";

/** Kinds that change what search engines should recrawl (an unpublished or archived URL too). */
const INDEXNOW_KINDS: readonly ContentChangedPayload["kind"][] = [
  "published",
  "updated",
  "moved",
  "archived",
  "unpublished",
];

export interface ContentChangeDeps {
  logger: Pick<Logger, "info" | "warn">;
  webInternalUrl: string | undefined;
  revalidateSecret: string | undefined;
  /** First `WEB_ORIGIN` entry; IndexNow URLs are built on it. */
  webOrigin: string;
  /** `seo.indexNow` setting, read fresh so the admin's switch applies to the next event. */
  indexNowSettings(): Promise<{ enabled: boolean; key: string | null }>;
  enqueueIndexNow(urls: string[]): Promise<void>;
  fetchImpl?: typeof fetch;
  lookupItem?: typeof findChangedItem;
}

/** Absolute, de-duplicated URLs to announce; none when the item asked not to be indexed. */
export function indexNowUrls(
  payload: ContentChangedPayload,
  item: Pick<ChangedItemRow, "noindex"> | null,
  webOrigin: string,
): string[] {
  if (!INDEXNOW_KINDS.includes(payload.kind)) return [];
  if (item?.noindex) return [];
  let origin: URL;
  try {
    origin = new URL(webOrigin);
  } catch {
    return [];
  }
  // The IndexNow job only accepts https; a plain-http dev origin has nothing to announce.
  if (origin.protocol !== "https:") return [];
  return [
    ...new Set(
      [...payload.paths, ...payload.oldPaths].map((path) =>
        new URL(path, origin.origin).toString(),
      ),
    ),
  ];
}

/**
 * Outbox topic `content.changed`: purge the web cache, then ping IndexNow. A web failure throws, so
 * the outbox retries the whole event; both steps are idempotent. Logs counts only.
 */
export function contentChangeHandler(deps: ContentChangeDeps): OutboxHandler {
  const lookup = deps.lookupItem ?? findChangedItem;
  return async (tx, entry) => {
    const payload = contentChangedPayloadSchema.parse(entry.payload);
    const item = payload.itemId === null ? null : await lookup(tx, payload.itemId);
    const tags = deriveCacheTags({ kind: payload.kind, itemId: payload.itemId, item });
    await revalidateTags({
      webInternalUrl: deps.webInternalUrl,
      secret: deps.revalidateSecret,
      tags,
      logger: deps.logger,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });

    const urls = indexNowUrls(payload, item, deps.webOrigin);
    deps.logger.info(
      { kind: payload.kind, tags: tags.length, urls: urls.length },
      "Content change handled",
    );
    if (urls.length === 0) return;
    const { enabled, key } = await deps.indexNowSettings();
    if (!enabled || key === null) return;
    for (let start = 0; start < urls.length; start += INDEXNOW_MAX_URLS) {
      await deps.enqueueIndexNow(urls.slice(start, start + INDEXNOW_MAX_URLS));
    }
  };
}
