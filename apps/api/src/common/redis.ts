import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";

export const REDIS = Symbol("REDIS");

export function createRedis(url: string): Redis {
  return new Redis(url, {
    // Fail fast so readiness checks and rate limiting never hang on a dead Redis
    // (the offline queue stays on so commands issued during the first connect are not lost).
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 1_000,
  });
}

class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

/** One shared ioredis connection for the whole API (rate limits, cache, health). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => createRedis(env.REDIS_URL),
    },
    RedisShutdown,
  ],
  exports: [REDIS],
})
export class RedisModule {}
