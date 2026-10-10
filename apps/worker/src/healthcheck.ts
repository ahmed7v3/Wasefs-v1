import { WORKER_HEARTBEAT_KEY, workerStatus } from "@wasfa/shared/queues";
import { Redis } from "ioredis";

/**
 * Container health probe (the worker has no HTTP port): exits 0 only when the heartbeat the
 * worker writes every 5 minutes is fresh. Prints nothing that could leak the Redis URL.
 */
async function isHealthy(url: string): Promise<boolean> {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    lazyConnect: true,
  });
  // Failures are reported through the exit code; without a listener ioredis prints each one.
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    return workerStatus(await redis.get(WORKER_HEARTBEAT_KEY)) === "ok";
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

const url = process.env.REDIS_URL;
process.exit(url !== undefined && url !== "" && (await isHealthy(url)) ? 0 : 1);
