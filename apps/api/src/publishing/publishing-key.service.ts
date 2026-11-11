import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
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
const TOKEN_BUCKET_LUA = `
local now = tonumber(ARGV[1]); local rate = tonumber(ARGV[2]); local burst = tonumber(ARGV[3]); local cost = tonumber(ARGV[4]);
local state = redis.call('HMGET', KEYS[1], 'tokens', 'at');
local tokens = tonumber(state[1]) or burst; local at = tonumber(state[2]) or now;
tokens = math.min(burst, tokens + math.max(0, now - at) * rate);
local allowed = 0; if tokens >= cost then tokens = tokens - cost; allowed = 1 end;
redis.call('HMSET', KEYS[1], 'tokens', tokens, 'at', now); redis.call('EXPIRE', KEYS[1], math.ceil(burst / rate) + 60);
return {allowed, tokens, math.ceil((burst - tokens) / rate), math.ceil((cost - tokens) / rate)};
`;
const CONCURRENCY_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]);
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end;
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4]); redis.call('EXPIRE', KEYS[1], 180); return 1;
`;
const RENEW_LUA = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then return 0 end;
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1]); redis.call('EXPIRE', KEYS[1], 180); return 1;
`;
const RELEASE_LUA = `redis.call('ZREM', KEYS[1], ARGV[1]); return 1;`;
const MEDIA_LUA = `
local now=tonumber(ARGV[1]); local minuteRate=1/3; local cap=500;
local state=redis.call('HMGET',KEYS[1],'tokens','at'); local t=tonumber(state[1]) or 20; local at=tonumber(state[2]) or now;
t=math.min(20,t+math.max(0,now-at)*minuteRate);
local day=tonumber(redis.call('GET',KEYS[2]) or '0');
if t < 1 or day >= cap then return {0, math.ceil((1-t)/minuteRate), day >= cap and tonumber(ARGV[2]) or 0} end;
t=t-1; redis.call('HMSET',KEYS[1],'tokens',t,'at',now); redis.call('EXPIRE',KEYS[1],180);
local n=redis.call('INCR',KEYS[2]); if n==1 then redis.call('EXPIRE',KEYS[2],tonumber(ARGV[3])) end;
return {1,0,0};
`;

export interface RateLimitState {
  limit: number;
  remaining: number;
  /** Seconds until the bucket refills completely. */
  resetSeconds: number;
  /** Seconds until one request token is available again. */
  retryAfterSeconds: number;
  allowed: boolean;
}

export function toPrincipal(row: PublishingApiKeyRow): PublishingPrincipal {
  return {
    keyId: row.id,
    keyName: row.name,
    ownerUserId: row.ownerUserId,
    scopes: row.scopes as PublishingScope[],
    canPublish: row.canPublish,
    requireSignature: row.requireSignature,
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
    return (await this.authenticateAttempt(raw, now)).row;
  }

  /** Includes only the real row id for a syntactically presented key that mapped to an actual DB row. */
  async authenticateAttempt(raw: string, now: Date): Promise<{ row: PublishingApiKeyRow | null; knownKeyId: string | null }> {
    const parsed = parsePublishingKey(raw);
    if (!parsed) return { row: null, knownKeyId: null };
    let row = this.cache.get(parsed.keyId);
    if (!row) {
      row = await this.repo.findByKeyId(parsed.keyId);
      if (row) this.cache.set(parsed.keyId, row);
    }
    const secretOk = verifyKeySecret(
      this.pepper,
      parsed.secret,
      row ?? { secretHash: this.decoyHash, prevSecretHash: null, prevValidUntil: null },
      now,
    );
    const knownKeyId = row?.id ?? null;
    if (!row || !secretOk || row.environment !== parsed.environment || row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime()) {
      return { row: null, knownKeyId };
    }
    return { row, knownKeyId };
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
      this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "last_used_at update failed");
    });
  }

  /** Distributed token bucket; Redis errors fail closed. */
  async consumeRate(row: PublishingApiKeyRow, now: Date): Promise<RateLimitState> {
    const limit = row.requestsPerMinute;
    try {
      const result = (await this.redis.eval(TOKEN_BUCKET_LUA, 1, `pub:tb:${row.id}`, String(now.getTime() / 1000), String(limit / 60), "20", "1")) as [number, number, number, number];
      const allowed = Number(result[0]) === 1;
      return {
        limit,
        remaining: Math.floor(Number(result[1])),
        resetSeconds: Math.max(1, Number(result[2])),
        retryAfterSeconds: Math.max(1, Number(result[3])),
        allowed,
      };
    } catch (error) {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "Publishing rate limit unavailable");
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
    }
  }

  async consumeReplay(keyId: string, signature: string): Promise<boolean> {
    try { return (await this.redis.set(`pub:sig:${keyId}:${signature}`, "1", "EX", 601, "NX")) === "OK"; }
    catch (error) {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "Publishing replay cache unavailable");
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
    }
  }

  async acquireConcurrency(keyId: string, token: string, now: number): Promise<boolean> {
    try {
      return Number(await this.redis.eval(CONCURRENCY_LUA, 1, `pub:conc:${keyId}`, String(now), "4", String(now + 120_000), token)) === 1;
    } catch (error) {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "Publishing concurrency limit unavailable");
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
    }
  }

  async renewConcurrency(keyId: string, token: string, now: number): Promise<void> {
    try { await this.redis.eval(RENEW_LUA, 1, `pub:conc:${keyId}`, token, String(now + 120_000)); }
    catch (error) {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "Publishing concurrency renewal failed");
    }
  }

  async releaseConcurrency(keyId: string, token: string): Promise<void> {
    try { await this.redis.eval(RELEASE_LUA, 1, `pub:conc:${keyId}`, token); }
    catch (error) { this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "Publishing concurrency release failed"); }
  }

  async consumeMedia(keyId: string, now: Date): Promise<{ allowed: boolean; retryAfter: number }> {
    try {
      const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
      const ttl = Math.ceil((day.getTime() + 86_400_000 - now.getTime()) / 1000);
      const result = (await this.redis.eval(MEDIA_LUA, 2, `pub:media:tb:${keyId}`, `pub:media:day:${keyId}:${day.toISOString().slice(0, 10)}`, String(now.getTime() / 1000), String(ttl), String(ttl))) as number[];
      return { allowed: Number(result[0]) === 1, retryAfter: Math.max(1, Number(result[2]) || Number(result[1]) || ttl) };
    } catch (error) {
      this.logger.warn({ errorClass: error instanceof Error ? error.name : "unknown" }, "Publishing media limit unavailable");
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
    }
  }
}
