import { sql } from "drizzle-orm";

import type { JobContext } from "../queues.js";
import type { Database } from "@wasfa/db";
import type { JobPayload } from "@wasfa/shared/queues";

type ReconcileContext = Pick<JobContext, "db" | "logger">;

/** How many drifted wallet ids a run lists in its alert; the count is always exact. */
export const DRIFT_REPORT_LIMIT = 50;

export interface ReconcileResult {
  wallets: number;
  drifted: number;
}

/**
 * Compares every wallet's stored balance with the sum of its ledger rows. Each wallet change and
 * its ledger row commit together, so a mismatch means a bug or a manual edit, never a race: the
 * comparison is one statement (one snapshot), so a transaction that is mid-flight is not seen
 * half-done.
 */
export async function reconcileCredits(
  db: Database,
  report: (walletIds: string[]) => void = () => undefined,
): Promise<ReconcileResult> {
  const totals = await db.execute<{ wallets: number; drifted: number }>(sql`
    select
      count(*)::int as wallets,
      (count(*) filter (where w.balance <> coalesce(l.total, 0)))::int as drifted
    from credit_wallets w
    left join (
      select wallet_id, sum(amount) as total from credit_ledger group by wallet_id
    ) l on l.wallet_id = w.id
  `);
  const { wallets = 0, drifted = 0 } = totals[0] ?? {};
  if (drifted > 0) {
    const rows = await db.execute<{ id: string }>(sql`
      select w.id
      from credit_wallets w
      left join (
        select wallet_id, sum(amount) as total from credit_ledger group by wallet_id
      ) l on l.wallet_id = w.id
      where w.balance <> coalesce(l.total, 0)
      order by w.id
      limit ${DRIFT_REPORT_LIMIT}
    `);
    report(rows.map((row) => row.id));
  }
  return { wallets, drifted };
}

/**
 * `credits.reconcile`, nightly at 02:00 UTC. Drift is logged at error level with event
 * `credits.drift` (the alert channel is the log until a notifier exists); ids only, no amounts of
 * a person. It does not throw: retrying cannot fix drift, and a failing job would hide the alert.
 */
export async function reconcileCreditsJob(
  _payload: JobPayload<"credits", "credits.reconcile">,
  { db, logger }: ReconcileContext,
): Promise<void> {
  let walletIds: string[] = [];
  const result = await reconcileCredits(db, (ids) => {
    walletIds = ids;
  });
  if (result.drifted > 0) {
    logger.error({ event: "credits.drift", ...result, walletIds }, "Credit wallet drift detected");
  } else {
    logger.info(result, "Credit wallets reconciled");
  }
}
