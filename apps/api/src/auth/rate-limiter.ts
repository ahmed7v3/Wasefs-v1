import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";

/** Counters never hold the identifier itself: a hash keeps emails and phones out of Redis keys. */
export function identifierKey(identifier: string): string {
  return createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex").slice(0, 32);
}

const FAILURE_WINDOW_SECONDS = 15 * 60;

/**
 * Fixed-window counters for the auth endpoints. Unlike the global limiter (which fails open so a
 * Redis outage does not take the whole API down), these **fail closed**: if Redis cannot be
 * reached, login, register and reset are refused rather than left unprotected.
 */
@Injectable()
export class AuthRateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Counts one hit and throws `RATE_LIMITED` once `max` is exceeded within the window. */
  async hit(key: string, max: number, windowSeconds: number): Promise<void> {
    const redisKey = `auth:rl:${key}`;
    let count: number;
    let ttlMs: number;
    try {
      const results = await this.redis
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds, "NX")
        .pttl(redisKey)
        .exec();
      count = Number(results?.[0]?.[1]);
      ttlMs = Number(results?.[2]?.[1]);
      if (!Number.isFinite(count)) throw new Error("Unexpected Redis reply");
    } catch (cause) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
    if (count > max) {
      const waitMs = ttlMs > 0 ? ttlMs : windowSeconds * 1000;
      throw new AppError(ErrorCode.RATE_LIMITED, {
        details: { retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) },
      });
    }
  }

  /** Failed sign-ins for an identifier in the last 15 minutes, whether or not the account exists. */
  async failures(identifier: string): Promise<number> {
    try {
      return Number((await this.redis.get(`auth:fail:${identifierKey(identifier)}`)) ?? 0);
    } catch (cause) {
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
  }

  async recordFailure(identifier: string): Promise<void> {
    const key = `auth:fail:${identifierKey(identifier)}`;
    try {
      await this.redis.multi().incr(key).expire(key, FAILURE_WINDOW_SECONDS, "NX").exec();
    } catch {
      // The attempt was already counted by the fail-closed limiter; one lost failure count is harmless.
    }
  }

  async clearFailures(identifier: string): Promise<void> {
    try {
      await this.redis.del(`auth:fail:${identifierKey(identifier)}`);
    } catch {
      // Expires on its own within 15 minutes.
    }
  }
}
