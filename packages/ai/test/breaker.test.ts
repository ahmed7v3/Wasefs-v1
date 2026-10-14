import { describe, expect, it } from "vitest";

import {
  BREAKER_FAILURE_THRESHOLD,
  MemoryBreakerStore,
  RedisBreakerStore,
  type BreakerStore,
} from "../src/index.js";

import { FakeRedis } from "./fake-redis.js";

async function fail(store: BreakerStore, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await store.recordFailure("m1");
}

describe("RedisBreakerStore", () => {
  it("opens after 5 failures, stays closed before, and closes when the open key expires", async () => {
    const redis = new FakeRedis();
    const store = new RedisBreakerStore(redis);

    await fail(store, BREAKER_FAILURE_THRESHOLD - 1);
    expect(await store.isOpen("m1")).toBe(false);
    await fail(store, 1);
    expect(await store.isOpen("m1")).toBe(true);
    expect(redis.ttlSeconds("ai:breaker:open:m1")).toBe(60);
    expect(redis.ttlSeconds("ai:breaker:fail:m1")).toBe(60);

    redis.advance(59);
    expect(await store.isOpen("m1")).toBe(true);
    redis.advance(2);
    expect(await store.isOpen("m1")).toBe(false);
  });

  it("forgets failures that are older than the window", async () => {
    const redis = new FakeRedis();
    const store = new RedisBreakerStore(redis);
    await fail(store, 4);
    redis.advance(61);
    await fail(store, 1);
    expect(await store.isOpen("m1")).toBe(false);
  });

  it("clears the failure count on success and keeps models apart", async () => {
    const redis = new FakeRedis();
    const store = new RedisBreakerStore(redis);
    await fail(store, 4);
    await store.recordSuccess("m1");
    await fail(store, 4);
    expect(await store.isOpen("m1")).toBe(false);
    await fail(store, 1);
    expect(await store.isOpen("m1")).toBe(true);
    expect(await store.isOpen("m2")).toBe(false);
  });
});

describe("MemoryBreakerStore", () => {
  it("behaves like the Redis store: opens at 5, closes after 60 s", async () => {
    let now = 0;
    const store = new MemoryBreakerStore(() => now);
    await fail(store, 5);
    expect(await store.isOpen("m1")).toBe(true);
    now += 61_000;
    expect(await store.isOpen("m1")).toBe(false);
  });
});
