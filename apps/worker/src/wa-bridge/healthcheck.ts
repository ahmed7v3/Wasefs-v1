import { WA_HEARTBEAT_KEY, waStatus } from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";

/**
 * Container health probe for the bridge: healthy while its 30-second heartbeat is fresh, whatever the
 * WhatsApp state is (a logged-out bridge is alive and waiting for an operator, not a crash to restart).
 */
async function isHealthy(url: string): Promise<boolean> {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3_000,
    commandTimeout: 3_000,
    lazyConnect: true,
  });
  redis.on("error", () => undefined);
  try {
    await redis.connect();
    return waStatus(await redis.get(WA_HEARTBEAT_KEY)) !== "down";
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

const url = process.env.REDIS_URL;
process.exit(url !== undefined && url !== "" && (await isHealthy(url)) ? 0 : 1);
