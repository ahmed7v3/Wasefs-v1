import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  WA_LOGIN_ALPHABET,
  WA_LOGIN_TTL_SECONDS,
  type WaLoginStatusReason,
} from "@wasfa/shared/schemas/wa-login";

import { identifierKey } from "../rate-limiter.js";

import type { Redis } from "ioredis";

/**
 * A challenge key lives a minute past its 5 minutes. The challenge itself expires on its own clock
 * (`createdAt`): the extra minute is what lets the browser that asked be told "expired" (nonce
 * checked first) instead of a missing key, which would say the same to everyone, token or not.
 */
const GRACE_SECONDS = 60;
const TTL_MS = WA_LOGIN_TTL_SECONDS * 1000;
const CLAIMS_PER_HOUR = 5;
const HOUR_SECONDS = 60 * 60;

const challengeKey = (token: string): string => `wa:login:${token}`;

/*
 * Lua keeps every state change a single atomic step, so a replayed message, a second api replica
 * and a double poll can each win at most once.
 *
 *   create : nothing under the key -> pending
 *   claim  : pending and not expired -> claimed        (the consumer then looks up or creates the user)
 *   settle : claimed -> approved | refused             (what the browser's poll picks up)
 *   take   : approved | refused -> returned and deleted; expired -> deleted; otherwise untouched
 */
export const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'nonceHash', ARGV[1], 'createdAt', ARGV[2], 'status', 'pending', 'ua', ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1`;

export const CLAIM_SCRIPT = `
local created = tonumber(redis.call('HGET', KEYS[1], 'createdAt'))
if not created then return 0 end
if redis.call('HGET', KEYS[1], 'status') ~= 'pending' then return 0 end
if tonumber(ARGV[1]) - created > tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], 'status', 'claimed')
return 1`;

export const SETTLE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'status') ~= 'claimed' then return 0 end
redis.call('HSET', KEYS[1], 'status', ARGV[1], 'userId', ARGV[2], 'isNew', ARGV[3], 'reason', ARGV[4])
return 1`;

export const TAKE_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if not status then return {} end
if status == 'approved' or status == 'refused' then
  local r = redis.call('HMGET', KEYS[1], 'userId', 'isNew', 'reason')
  redis.call('DEL', KEYS[1])
  return {status, r[1] or '', r[2] or '', r[3] or ''}
end
local created = tonumber(redis.call('HGET', KEYS[1], 'createdAt'))
if tonumber(ARGV[1]) - created > tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return {'expired'}
end
return {'pending'}`;

export type TakeResult =
  | { status: "pending" | "expired" }
  | { status: "approved"; userId: string; isNew: boolean }
  | { status: "refused"; reason: WaLoginStatusReason };

export type SettleOutcome =
  | { status: "approved"; userId: string; isNew: boolean }
  | { status: "refused"; reason: WaLoginStatusReason };

/** SHA-256 of the nonce cookie: the only form of it that is ever stored. */
export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 8 random characters of Crockford base32 (40 bits). */
export function newLoginToken(): string {
  const bytes = randomBytes(8);
  let token = "";
  for (let index = 0; index < 8; index++) {
    token += WA_LOGIN_ALPHABET[(bytes[index] ?? 0) & 31];
  }
  return token;
}

const REASONS = new Set<string>(["two_factor", "privileged", "inactive", "signup_closed"]);

/** `wa:login:<token>` challenges and the per-phone claim counters. Keys never hold a phone number. */
export class WaLoginStore {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  /** A fresh pending challenge bound to `nonceHash`. */
  async create(nonceHash: string, device: string): Promise<{ token: string; expiresAt: number }> {
    const createdAt = this.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = newLoginToken();
      const created = await this.redis.eval(
        CREATE_SCRIPT,
        1,
        challengeKey(token),
        nonceHash,
        String(createdAt),
        device,
        String(WA_LOGIN_TTL_SECONDS + GRACE_SECONDS),
      );
      if (Number(created) === 1) return { token, expiresAt: createdAt + TTL_MS };
    }
    throw new Error("Could not allocate a login token");
  }

  /** pending -> claimed, once. False for an unknown, expired, replayed or already claimed token. */
  async claim(token: string): Promise<boolean> {
    const result = await this.redis.eval(
      CLAIM_SCRIPT,
      1,
      challengeKey(token),
      String(this.now()),
      String(TTL_MS),
    );
    return Number(result) === 1;
  }

  /** claimed -> approved | refused, once. */
  async settle(token: string, outcome: SettleOutcome): Promise<boolean> {
    const approved = outcome.status === "approved";
    const result = await this.redis.eval(
      SETTLE_SCRIPT,
      1,
      challengeKey(token),
      outcome.status,
      approved ? outcome.userId : "",
      approved && outcome.isNew ? "1" : "0",
      approved ? "" : outcome.reason,
    );
    return Number(result) === 1;
  }

  /** The nonce hash a challenge is bound to, or null when there is no such challenge. */
  async nonceHashOf(token: string): Promise<string | null> {
    return this.redis.hget(challengeKey(token), "nonceHash");
  }

  /**
   * The browser's poll. Compares the cookie's hash in constant time and answers `pending` for
   * everything that does not match (wrong cookie, no cookie, unknown token), so the endpoint cannot
   * be used to learn whether a token exists. A match consumes an approved or refused result.
   */
  async take(token: string, nonceHash: string): Promise<TakeResult> {
    const stored = await this.nonceHashOf(token);
    if (stored === null || !sameHash(stored, nonceHash)) return { status: "pending" };

    const raw = (await this.redis.eval(
      TAKE_SCRIPT,
      1,
      challengeKey(token),
      String(this.now()),
      String(TTL_MS),
    )) as string[] | null;
    const [status, userId, isNew, reason] = raw ?? [];
    if (status === "approved" && userId) return { status, userId, isNew: isNew === "1" };
    if (status === "refused" && reason && REASONS.has(reason)) {
      return { status, reason: reason as WaLoginStatusReason };
    }
    return { status: status === "expired" ? "expired" : "pending" };
  }

  /**
   * Counts one claim from this sender (phone hashed) and says whether it may proceed: more than 5 an
   * hour is ignored silently. `scope` keeps sign-in claims and logout commands apart.
   */
  async allowClaim(scope: "login" | "logout", phone: string): Promise<boolean> {
    const key = `wa:login:claims:${scope}:${identifierKey(phone)}`;
    const results = await this.redis.multi().incr(key).expire(key, HOUR_SECONDS, "NX").exec();
    const count = Number(results?.[0]?.[1]);
    return Number.isFinite(count) && count <= CLAIMS_PER_HOUR;
  }
}
