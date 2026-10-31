import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StreamConsumer } from "../../src/wa-agent/transport/stream-consumer.js";
import { quietLogger } from "../support/wa-agent-commerce-fakes.js";

import type { ApiEnv } from "../../src/config/env.js";

/*
 * R14 of docs/WA-AGENT-RUNTIME.md §2 against a real Redis: a stream handler that throws must leave
 * the entry pending, and after 5 deliveries it lands in `wa:agent:dlq`. Only Redis is started (the
 * consumer needs nothing else); `TEST_REDIS_URL` points at an existing one instead.
 */

const DLQ = "wa:agent:dlq";
const MAX_DELIVERIES = 5;

class ThrowingConsumer extends StreamConsumer {
  deliveries = 0;

  constructor(env: ApiEnv, stream: string) {
    super(env, quietLogger, stream, "r14", { isV2: () => Promise.resolve(true) });
  }

  override process(): Promise<void> {
    this.deliveries += 1;
    return Promise.reject(new Error("handler failed"));
  }
}

let container: StartedRedisContainer | undefined;
let redis: Redis;
let url: string;
let counter = 0;

beforeAll(async () => {
  const external = process.env["TEST_REDIS_URL"];
  if (external) {
    url = external;
  } else {
    container = await new RedisContainer("redis:8-alpine").start();
    url = container.getConnectionUrl();
  }
  redis = new Redis(url, { maxRetriesPerRequest: null });
  await redis.del(DLQ);
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await container?.stop();
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function pendingCount(stream: string): Promise<number> {
  const summary = (await redis.xpending(stream, "r14")) as [number, ...unknown[]];
  return summary[0];
}

/** Starts a consumer on a fresh stream and adds one entry; returns once the first delivery was handled. */
async function startWithOneEntry() {
  counter += 1;
  const stream = `wa:agent:test-r14-${String(counter)}-${String(Date.now())}`;
  const consumer = new ThrowingConsumer(fake<ApiEnv>({ REDIS_URL: url }), stream);
  await consumer.onModuleInit();
  const id = await redis.xadd(stream, "*", "data", JSON.stringify({ n: 1 }));
  for (let waited = 0; waited < 8_000 && consumer.deliveries === 0; waited += 100) await sleep(100);
  // Give a (wrong) acknowledgement time to land.
  await sleep(300);
  return { stream, consumer, id: id ?? "" };
}

function fake<T>(value: object): T {
  return value as unknown as T;
}

describe("R14 stream retries and dead letter", () => {
  it("R14 ", async () => {
    const { stream, consumer } = await startWithOneEntry();
    try {
      expect(consumer.deliveries, "R14: the handler ran for the entry").toBeGreaterThanOrEqual(1);
      expect(await pendingCount(stream), "R14: a failed entry is not acked, it stays pending").toBe(
        1,
      );
    } finally {
      await consumer.onApplicationShutdown();
    }
  }, 60_000);

  it("R14 ", async () => {
    const { stream, consumer, id } = await startWithOneEntry();
    try {
      // Age the pending entry so the consumer's idle-claim sees it as abandoned (JUSTID: the
      // delivery count is not touched), until it is dead-lettered or the wait runs out.
      for (let waited = 0; waited < 40_000; waited += 500) {
        if ((await redis.xlen(DLQ)) > 0 || (await pendingCount(stream)) === 0) break;
        await redis.xclaim(stream, "r14", "aging", 0, id, "IDLE", 120_000, "JUSTID");
        await sleep(500);
      }
      expect(consumer.deliveries, "R14: the handler is delivered 5 times before dead-letter").toBe(
        MAX_DELIVERIES,
      );
      const dead = await redis.xrange(DLQ, "-", "+");
      const flat = JSON.stringify(dead);
      expect(flat, "R14: the dead-letter entry names the stream").toContain(stream);
      expect(flat, "R14: the dead-letter entry names the original id").toContain(id);
      expect(await pendingCount(stream), "R14: the dead-lettered entry is acked").toBe(0);
    } finally {
      await consumer.onApplicationShutdown();
    }
  }, 90_000);
});
