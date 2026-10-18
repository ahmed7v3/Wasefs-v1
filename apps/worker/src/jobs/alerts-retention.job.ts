import { adminAlerts } from "@wasfa/db";
import { lt } from "drizzle-orm";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

export async function alertsRetentionJob(
  _payload: JobPayload<"payments", "alerts.retention">,
  { db }: Pick<JobContext, "db">,
): Promise<void> {
  await db
    .delete(adminAlerts)
    .where(lt(adminAlerts.createdAt, new Date(Date.now() - 90 * 86_400_000)));
}
