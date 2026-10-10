import { WORKER_HEARTBEAT_KEY, workerStatus } from "@wasfa/shared/queues";
import { Redis } from "ioredis";

/**
 * Container health probe (the worker has no HTTP port): exits 0 only when the heartbeat the
 * worker writes every 5 minutes is fresh. Prints nothing that could leak the Redis URL.
 */
const url = process.env.REDIS_URL;
if (!url) {
  process.exit(1);
}

const redis = new Redis(url, {
  maxRetriesPerRequest: 1,
  connectTimeout: 3_000,
  commandTimeout: 3_000,
  lazyConnect: true,
});

let healthy = false;
try {
  await redis.connect();
  healthy = workerStatus(await redis.get(WORKER_HEARTBEAT_KEY)) === "ok";
} catch {
  healthy = false;
} finally {
  redis.disconnect();
}
process.exit(healthy ? 0 : 1);
