import {
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_OPEN_SECONDS,
  BREAKER_WINDOW_SECONDS,
  type BreakerStore,
} from "./breaker.js";

import type { BreakerRedis } from "./redis-like.js";

const failKey = (modelId: string) => `ai:breaker:fail:${modelId}`;
const openKey = (modelId: string) => `ai:breaker:open:${modelId}`;

/**
 * Breaker state shared by every API and worker process. Both keys expire on their own (the failure
 * counter after 60 s without a new failure, the open flag after 60 s), so the breaker closes by
 * itself: a model that is still down just trips it again after five more failures.
 */
export class RedisBreakerStore implements BreakerStore {
  constructor(private readonly redis: BreakerRedis) {}

  async isOpen(modelId: string): Promise<boolean> {
    return (await this.redis.get(openKey(modelId))) !== null;
  }

  async recordFailure(modelId: string): Promise<void> {
    const key = failKey(modelId);
    const failures = await this.redis.incr(key);
    // Refreshed on every failure so a counter is never left without a TTL if a call dies in between.
    await this.redis.expire(key, BREAKER_WINDOW_SECONDS);
    if (failures >= BREAKER_FAILURE_THRESHOLD) {
      await this.redis.set(openKey(modelId), "1", "EX", BREAKER_OPEN_SECONDS);
    }
  }

  async recordSuccess(modelId: string): Promise<void> {
    await this.redis.del(failKey(modelId));
  }
}
