import { expireUnused, grant, grantPeriod } from "@wasfa/db";

import { findGrantCandidates } from "./credits.repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

/** A run never works for long: whoever is left is picked up by the next daily run. */
export const GRANT_BATCH_SIZE = 200;
export const GRANT_MAX_BATCHES = 500;

type GrantContext = Pick<JobContext, "db" | "logger">;

/** `YYYY-MM` of the month before `period`. */
export function previousPeriod(period: string): string {
  const [year = 0, month = 1] = period.split("-").map(Number);
  return month === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * `credits.grant_monthly`: gives every eligible user the monthly credits of their plan for the
 * current UTC month. Idempotent per user and period (ledger key `grant:user:<id>:<YYYY-MM>`), so it
 * runs daily: a late run, a retry or a user who became eligible mid-month never gets paid twice.
 * Just before a user is paid for a new period, the unused part of LAST period's grant expires
 * (`expireUnused`: min(balance, last grant), ledger key `expiry:<walletId>:<YYYY-MM>`), so free
 * credits do not pile up month over month. Expiry failing skips the grant for that user; the next
 * daily run retries both. Logs counts only.
 */
export async function grantMonthlyJob(
  _payload: JobPayload<"credits", "credits.grant_monthly">,
  { db, logger }: GrantContext,
  now = new Date(),
): Promise<void> {
  const period = grantPeriod(now);
  let granted = 0;
  let failed = 0;
  let afterId: string | null = null;

  for (let batch = 0; batch < GRANT_MAX_BATCHES; batch++) {
    const candidates = await findGrantCandidates(db, now, period, afterId, GRANT_BATCH_SIZE);
    if (candidates.length === 0) break;
    for (const { userId, monthlyCredits } of candidates) {
      try {
        const owner = { type: "user", id: userId } as const;
        await expireUnused(db, owner, previousPeriod(period));
        const write = await grant(db, owner, monthlyCredits, period);
        if (!write.replayed) granted++;
      } catch {
        // Driver messages can quote row values; the job only reports that a grant failed.
        failed++;
      }
    }
    afterId = candidates.at(-1)?.userId ?? null;
    if (candidates.length < GRANT_BATCH_SIZE) break;
  }

  logger.info({ period, granted, failed }, "Monthly credit grants finished");
  if (failed > 0) {
    throw new Error(`Granting credits failed for ${String(failed)} account(s)`);
  }
}
