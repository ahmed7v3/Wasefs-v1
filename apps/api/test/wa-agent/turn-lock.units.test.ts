import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConversationLock,
  LOCK_HEARTBEAT_MS,
  LOCK_TTL_MS,
  lockKey,
} from "../../src/wa-agent/turn/lock.js";
import { ExpiringRedis } from "../support/wa-agent-fakes.js";

import type { Redis } from "ioredis";

/*
 * The conversation lock (docs/WA-AGENT-RUNTIME.md §4.4): SET NX PX with a random token, a heartbeat that
 * renews it only while it is still ours, an abort when it cannot be renewed, a release that never deletes
 * somebody else's lock. Fake clock, in-memory Redis with expiry.
 */

const CONVERSATION = "0198a5d2-0000-7000-8000-000000000001";
const key = lockKey(CONVERSATION);

let redis: ExpiringRedis;
let lock: ConversationLock;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  redis = new ExpiringRedis();
  lock = new ConversationLock(redis as unknown as Redis);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConversationLock", () => {
  it("takes the lock for 60 s with a token, and refuses a second taker", async () => {
    const handle = await lock.acquire(CONVERSATION);
    expect(handle).not.toBeNull();
    expect(redis.ttlMs(key)).toBe(LOCK_TTL_MS);
    expect(await lock.acquire(CONVERSATION)).toBeNull();
    // Another conversation is independent.
    expect(await lock.acquire("0198a5d2-0000-7000-8000-000000000002")).not.toBeNull();
  });

  it("renews the lock every 15 s, so a long turn outlives the TTL", async () => {
    const handle = await lock.acquire(CONVERSATION);
    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS * 3);
    expect(redis.ttlMs(key)).toBeGreaterThan(0);
    expect(handle?.signal.aborted).toBe(false);
    expect(await lock.acquire(CONVERSATION)).toBeNull();
    // The renewal came less than one beat ago.
    expect(redis.ttlMs(key)).toBeGreaterThan(LOCK_TTL_MS - LOCK_HEARTBEAT_MS - 1);
  });

  it("a lock that expires or is taken over aborts the holder at its next beat", async () => {
    const handle = await lock.acquire(CONVERSATION);
    // The key is gone (Redis restart, expiry) and another worker took it.
    redis.values.delete(key);
    await redis.set(key, "someone-else", "PX", LOCK_TTL_MS, "NX");
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS + 10);
    expect(handle?.signal.aborted).toBe(true);
    expect((handle?.signal.reason as Error).message).toBe("lock lost");
    // The new holder's lock was not touched by the old one's renewals.
    expect(redis.values.get(key)).toBe("someone-else");
  });

  it("release deletes the lock only while it is still ours", async () => {
    const mine = await lock.acquire(CONVERSATION);
    await mine?.release();
    expect(redis.values.has(key)).toBe(false);
    // Releasing twice is harmless.
    await mine?.release();

    const old = await lock.acquire(CONVERSATION);
    redis.values.set(key, "someone-else");
    await old?.release();
    expect(redis.values.get(key)).toBe("someone-else");
  });

  it("stops renewing after release", async () => {
    const handle = await lock.acquire(CONVERSATION);
    await handle?.release();
    await redis.set(key, "next-holder", "PX", 1_000, "NX");
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS * 2);
    // Not extended (it expired after its own 1 s) and the old handle never aborted.
    expect(await redis.get(key)).toBeNull();
    expect(handle?.signal.aborted).toBe(false);
  });

  it("a Redis error on a beat is tolerated until the key could have expired", async () => {
    const handle = await lock.acquire(CONVERSATION);
    const failing = vi.spyOn(redis, "eval").mockRejectedValue(new Error("redis down"));
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS * 2);
    expect(handle?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS * 2);
    expect(handle?.signal.aborted).toBe(true);
    failing.mockRestore();
  });
});
