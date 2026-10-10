import { WORKER_HEARTBEAT_KEY, type JobPayload } from "@wasfa/shared/queues";

import type { JobContext } from "../queues.js";

/** `system.heartbeat`: stamps the current time so the API can tell a live worker from a dead one. */
export async function heartbeatJob(
  payload: JobPayload<"system", "system.heartbeat">,
  { redis, logger }: JobContext,
): Promise<void> {
  await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()));
  logger.debug({ source: payload.source }, "Heartbeat written");
}
