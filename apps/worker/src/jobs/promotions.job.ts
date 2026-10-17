import { refreshDiscountStatuses } from "./promotions.repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

export async function promotionsStatusJob(
  _payload: JobPayload<"payments", "promotions.status">,
  { db, logger }: Pick<JobContext, "db" | "logger">,
  now = new Date(),
): Promise<void> {
  const counts = await refreshDiscountStatuses(db, now);
  logger.info(counts, "Promotion and coupon statuses refreshed");
}
