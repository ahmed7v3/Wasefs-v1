import { Inject, Injectable } from "@nestjs/common";
import { parsePublishingKey } from "@wasfa/shared/publishing";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { InvalidationBus } from "../common/invalidation-bus.js";
import { LocalCache } from "../common/local-cache.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";

import { derivePepper, hashSecret, verifyKeySecret } from "./publishing-key-crypto.js";
import { PublishingKeysRepo } from "./publishing-keys.repo.js";

import type { PublishingPrincipal } from "./publishing-principal.js";
import type { PublishingApiKeyRow } from "@wasfa/db";
import type { PublishingContentType, PublishingScope } from "@wasfa/shared/publishing";

/** Key rows are cached this long in memory; revoke/update/rotate also drop them on every instance. */
export const KEY_CACHE_TTL_MS = 15_000;
const KEY_CHANNEL = "publishing:key";
const LAST_USED_THROTTLE_MS = 60_000;
const RATE_WINDOW_SECONDS = 60;

export interface RateLimitState {
  limit: number;
  remaining: number;
  /** Seconds until the current window ends. */
  resetSeconds: number;
  allowed: boolean;
}

export function toPrincipal(row: PublishingApiKeyRow): PublishingPrincipal {
  return {
    keyId: row.id,
    keyName: row.name,
    ownerUserId: row.ownerUserId,
    scopes: row.scopes as PublishingScope[],
    canPublish: row.canPublish,
    allowedTypes: row.allowedTypes as PublishingContentType[],
    allowedCategorySlugs: row.allowedCategorySlugs,
    defaultAuthorId: row.defaultAuthorId,
    defaultFeaturedMediaId: row.defaultFeaturedMediaId,
    dailyPublishCap: row.dailyPublishCap,
    requestsPerMinute: row.requestsPerMinute,
    environment: row.environment,
    expiresAt: row.expiresAt,
  };
}

/** Looks keys up, verifies secrets, counts requests per key. Used by the guard and the admin service. */
@Injectable()
export class PublishingKeyService {
  private readonly pepper: Buffer;
  private readonly cache = new LocalCache<PublishingApiKeyRow>(KEY_CACHE_TTL_MS);
  private readonly lastUsedAt = new Map<string, number>();
  /** Hash compared when the key id is unknown, so a miss costs the same as a wrong secret. */
  private readonly decoyHash: string;

  constructor(
    private readonly repo: PublishingKeysRepo,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly bus: InvalidationBus,
    private readonly logger: PinoLogger,
    @Inject(API_ENV) env: ApiEnv,
  ) {
    this.logger.setContext("PublishingKeys");
    this.pepper = derivePepper(encryptionKey(env));
    this.decoyHash = hashSecret(this.pepper, "decoy");
    this.bus.on(KEY_CHANNEL, (message) => {
      this.cache.delete(message);
    });
  }

  pepperOf(): Buffer {
    return this.pepper;
  }

  /**
   * The key row for a presented Bearer value, or null for anything wrong with it (malformed, unknown,
   * wrong secret or environment, revoked, expired): callers answer all of them identically.
   */
  async authenticate(raw: string, now: Date): Promise<PublishingApiKeyRow | null> {
    const parsed = parsePublishingKey(raw);
    if (!parsed) return null;
    let row = this.cache.get(parsed.keyId);
    if (!row) {
      row = await this.repo.findByKeyId(parsed.keyId);
      if (row) this.cache.set(parsed.keyId, row);
    }
    // Always run one comparison, found or not.
    const secretOk = verifyKeySecret(
      this.pepper,
      parsed.secret,
      row ?? { secretHash: this.decoyHash, prevSecretHash: null, prevValidUntil: null },
      now,
    );
    if (!row || !secretOk) return null;
    if (row.environment !== parsed.environment) return null;
    if (row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime()) return null;
    return row;
  }

  /** Called after any change of a key: this instance at once, the others through the bus (15 s TTL as fallback). */
  async invalidate(keyId: string): Promise<void> {
    this.cache.delete(keyId);
    await this.bus.publish(KEY_CHANNEL, keyId);
  }

  /** At most one `last_used_at` write per key per minute; fire and forget. */
  touchLastUsed(row: PublishingApiKeyRow, now: Date): void {
    const previous = this.lastUsedAt.get(row.id) ?? 0;
    if (now.getTime() - previous < LAST_USED_THROTTLE_MS) return;
    this.lastUsedAt.set(row.id, now.getTime());
    this.repo.touchLastUsed(row.id, now).catch((error: unknown) => {
      this.logger.warn({ reason: (error as Error).message }, "last_used_at update failed");
    });
  }

  /** Fixed 60 s window per key in Redis (`pub:rl:<keyId>:<minute>`). Fails open if Redis is down. */
  async consumeRate(row: PublishingApiKeyRow, now: Date): Promise<RateLimitState> {
    const limit = row.requestsPerMinute;
    const windowIndex = Math.floor(now.getTime() / (RATE_WINDOW_SECONDS * 1000));
    const resetSeconds = Math.max(
      1,
      (windowIndex + 1) * RATE_WINDOW_SECONDS - Math.floor(now.getTime() / 1000),
    );
    try {
      const key = `pub:rl:${row.keyId}:${String(windowIndex)}`;
      const used = await this.redis.incr(key);
      if (used === 1) await this.redis.expire(key, RATE_WINDOW_SECONDS * 2);
      return {
        limit,
        remaining: Math.max(0, limit - used),
        resetSeconds,
        allowed: used <= limit,
      };
    } catch (error) {
      this.logger.warn({ reason: (error as Error).message }, "Publishing rate limit unavailable");
      return { limit, remaining: limit, resetSeconds, allowed: true };
    }
  }
}
