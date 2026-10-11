import { sweepExpired } from "@wasfa/db";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type SweepContext = Pick<JobContext, "db" | "logger">;

/**
 * `credits.sweep_reservations`: releases reservations whose job crashed before it settled or
 * released them (the call's hold would otherwise stay on the wallet forever). Logs counts only.
 */
export async function sweepReservationsJob(
  _payload: JobPayload<"credits", "credits.sweep_reservations">,
  { db, logger }: SweepContext,
): Promise<void> {
  const { released, failed } = await sweepExpired(db, new Date());
  logger.info({ released, failed }, "Expired credit reservations released");
  if (failed > 0) {
    // Fail the job so it is visible and retried; the releases already done are committed.
    throw new Error(`Releasing ${String(failed)} reservation(s) failed`);
  }
}
