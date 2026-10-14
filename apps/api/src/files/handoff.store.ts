import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { HANDOFF_MAX_FILES, HANDOFF_TTL_SECONDS } from "@wasfa/shared/schemas/handoff";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";

/** How long an owner stays registered for a capture session (a desktop page left open). */
const SESSION_TTL_SECONDS = 3_600;

export interface HandoffRecord {
  userId: string;
  captureSessionId: string;
  /** Pages the token has been used for so far. */
  count: number;
  expiresAt: Date;
}

/** Redis channel that carries "a phone page is ready" events to the desktop of one capture session. */
export const handoffChannel = (captureSessionId: string): string => `handoff:${captureSessionId}`;

/** Only the hash of a token is stored: a Redis dump does not hold usable links. */
export const tokenHash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

// Reserve one page atomically: the key must still exist, and the counter never passes the cap.
const RESERVE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local count = redis.call('HINCRBY', KEYS[1], 'count', 1)
if count > tonumber(ARGV[1]) then
  redis.call('HINCRBY', KEYS[1], 'count', -1)
  return -2
end
return count
`;

/** All Redis state of the handoff: tokens, the files each added, and who owns a capture session. */
@Injectable()
export class HandoffStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async create(token: string, userId: string, captureSessionId: string): Promise<Date> {
    const key = this.tokenKey(token);
    await this.redis
      .multi()
      .hset(key, { userId, captureSessionId, count: 0 })
      .expire(key, HANDOFF_TTL_SECONDS)
      .exec();
    return new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000);
  }

  /** `null` for an unknown or expired token: the two look the same on purpose. */
  async find(token: string): Promise<HandoffRecord | null> {
    const key = this.tokenKey(token);
    const [fields, ttlMs] = await Promise.all([this.redis.hgetall(key), this.redis.pttl(key)]);
    const { userId, captureSessionId, count } = fields;
    if (!userId || !captureSessionId || ttlMs <= 0) return null;
    return {
      userId,
      captureSessionId,
      count: Number(count ?? 0),
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  /** Takes one of the token's pages. Throws when the token is gone (404) or used up (409). */
  async reserve(token: string): Promise<void> {
    const result = Number(
      await this.redis.eval(RESERVE, 1, this.tokenKey(token), String(HANDOFF_MAX_FILES)),
    );
    if (result === -1) throw new AppError(ErrorCode.NOT_FOUND);
    if (result === -2) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "handoff_full" } });
    }
  }

  /** Gives a page back when creating the upload failed after `reserve`. */
  async release(token: string): Promise<void> {
    await this.redis.hincrby(this.tokenKey(token), "count", -1).catch(() => undefined);
  }

  async addFile(token: string, fileId: string): Promise<void> {
    const key = `${this.tokenKey(token)}:files`;
    await this.redis.multi().sadd(key, fileId).expire(key, HANDOFF_TTL_SECONDS * 2).exec();
  }

  async hasFile(token: string, fileId: string): Promise<boolean> {
    return (await this.redis.sismember(`${this.tokenKey(token)}:files`, fileId)) === 1;
  }

  /**
   * Registers `userId` as the owner of a capture session, or confirms it already is. False when
   * someone else owns it: a session id is a random UUID, but a guessed one must not be claimable.
   */
  async claimSession(captureSessionId: string, userId: string): Promise<boolean> {
    const key = this.sessionKey(captureSessionId);
    const claimed = await this.redis.set(key, userId, "EX", SESSION_TTL_SECONDS, "NX");
    if (claimed === "OK") return true;
    if ((await this.redis.get(key)) !== userId) return false;
    await this.redis.expire(key, SESSION_TTL_SECONDS);
    return true;
  }

  async sessionOwner(captureSessionId: string): Promise<string | null> {
    return this.redis.get(this.sessionKey(captureSessionId));
  }

  async publish(captureSessionId: string, message: string): Promise<void> {
    await this.redis.publish(handoffChannel(captureSessionId), message);
  }

  private tokenKey(token: string): string {
    return `handoff:t:${tokenHash(token)}`;
  }

  private sessionKey(captureSessionId: string): string {
    return `handoff:s:${captureSessionId}`;
  }
}
