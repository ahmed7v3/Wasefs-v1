import { grantDealMonthlyBonuses } from "@wasfa/db";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type DealsJobContext = Pick<JobContext, "db" | "logger">;

/**
 * `deals.monthly_bonus`, daily at 04:20 UTC (REFERRALS §7.2 `credits.monthlyBonusCredits`): each
 * active organization deal pays its bonus into the organization wallet once per month. Late starts
 * and retries are safe: the ledger key is `deal_monthly:<deal>:<org>:<YYYY-MM>`.
 */
export async function dealsMonthlyBonusJob(
  _payload: JobPayload<"payments", "deals.monthly_bonus">,
  { db, logger }: DealsJobContext,
  now = new Date(),
): Promise<void> {
  const result = await grantDealMonthlyBonuses(db, now);
  if (result.failed > 0) {
    logger.warn({ event: "deals.monthly_bonus_failed", ...result }, "Some deal bonuses failed");
  } else if (result.granted > 0) {
    logger.info(result, "Deal monthly bonuses granted");
  }
}
