import { findMonthlyGrantCandidates, type Database, type GrantCandidate } from "@wasfa/db";

/*
 * The candidate query of the monthly grant lives in `@wasfa/db` (`monthly-grant`): the API uses the
 * same rule to pay a new account at once. The credit state machine itself (`grant`, `expireUnused`)
 * is `@wasfa/db`'s `credits-ledger`. The worker connects as the restricted role.
 */

/** Users due the grant of `period` and not paid yet, by id after `afterId` (see `@wasfa/db`). */
export async function findGrantCandidates(
  db: Database,
  now: Date,
  period: string,
  afterId: string | null,
  limit: number,
): Promise<GrantCandidate[]> {
  return findMonthlyGrantCandidates(db, now, period, { afterId, limit });
}

export type { GrantCandidate };
