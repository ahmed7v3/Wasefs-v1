import { lt } from "drizzle-orm";

import { publishingApiRequests } from "./schema/index.js";

import type { Database } from "./client.js";

/** Request-log retention of the Publishing API (docs/PUBLISHING-API.md section 10). */
export const PUBLISHING_REQUEST_RETENTION_DAYS = 90;

/**
 * Deletes request-log rows older than `days` and returns how many went. No worker job calls this
 * yet: wire it to a daily schedule (like the other retention sweeps) when the worker track picks it up.
 */
export async function purgeOlderThan(
  db: Database,
  days: number = PUBLISHING_REQUEST_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const deleted = await db
    .delete(publishingApiRequests)
    .where(lt(publishingApiRequests.at, cutoff))
    .returning({ id: publishingApiRequests.id });
  return deleted.length;
}
