import { lt } from "drizzle-orm";

import { publishingIdempotency } from "./schema/index.js";

import type { Database } from "./client.js";

/** Hours a stored idempotent answer is replayed (docs/PUBLISHING-API.md §4.1). */
export const PUBLISHING_IDEMPOTENCY_TTL_HOURS = 24;

/** Deletes every idempotency row older than the TTL; returns how many went. Safe to call from any job. */
export async function purgeExpiredPublishingIdempotency(
  db: Pick<Database, "delete">,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PUBLISHING_IDEMPOTENCY_TTL_HOURS * 3_600_000);
  const rows = await db
    .delete(publishingIdempotency)
    .where(lt(publishingIdempotency.createdAt, cutoff))
    .returning({ keyId: publishingIdempotency.keyId });
  return rows.length;
}
