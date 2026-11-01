import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { WA_AGENT_DLQ_STREAM } from "@wasfa/shared/schemas/phone";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StreamConsumer } from "../../src/wa-agent/stream-consumer.js";
import { DlqService } from "../../src/wa-agent/transport/dlq.service.js";
import { quietLogger } from "../support/wa-agent-commerce-fakes.js";

import type { ApiEnv } from "../../src/config/env.js";

/*
 * StreamConsumer v2 against a real Redis (docs/WA-AGENT-RUNTIME.md §4.1): acked only after the
 * handler resolved, redelivered while it throws, dead-lettered after 5 deliveries with ids only, and
 * replayed or discarded through `DlqService`. `waAgent.runtime.v2` off keeps v1 (ack always).
 */

const GROUP = "v2";
const TEXT = "my medicine list for the pharmacist";
const PHONE = "201001234567";

class TestConsumer extends StreamConsumer {
  deliveries = 0;
  failing = true;
  handled: unknown[] = [];

  constructor(env: ApiEnv, stream: string, v2: boolean, keepData = false) {
    super(env, quietLogger, stream, GROUP, { isV2: () => Promise.resolve(v2), keepData });
  }

  override process(payload: unknown): Promise<void> {
    this.deliveries += 1;
    // A payload that can never succeed is returned from, not thrown (as the real handlers do).
    if (payload === null) return Promise.resolve();
    if (this.failing) return Promise.reject(new TypeError("handler failed"));
    this.handled.push(payload);
    return Promise.resolve();
  }
}

let container: StartedRedisContainer | undefined;
let redis: Redis;
let url: string;
let dlq: DlqService;
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
  dlq = new DlqService(redis);
  await redis.del(WA_AGENT_DLQ_STREAM);
}, 180_000);

afterAll(async () => {
  await redis.quit();
  await container?.stop();
});

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const env = () => ({ REDIS_URL: url }) as unknown as ApiEnv;

async function pendingCount(stream: string): Promise<number> {
  const summary = (await redis.xpending(stream, GROUP)) as [number, ...unknown[]];
  return summary[0];
}

async function until(check: () => Promise<boolean> | boolean, ms: number): Promise<void> {
  for (let waited = 0; waited < ms; waited += 250) {
    if (await check()) return;
    await sleep(250);
  }
}

/** Starts a consumer on a fresh stream and adds one entry. */
async function start(v2: boolean, fields: string[], keepData = false) {
  counter += 1;
  const stream = `wa:agent:test-v2-${String(counter)}-${String(Date.now())}`;
  const consumer = new TestConsumer(env(), stream, v2, keepData);
  await consumer.onModuleInit();
  const id = (await redis.xadd(stream, "*", ...fields)) ?? "";
  return { stream, consumer, id };
}

/** Ages the pending entry so the idle claim sees it as abandoned, until `done`. */
async function ageUntil(
  stream: string,
  id: string,
  done: () => Promise<boolean> | boolean,
  ms: number,
) {
  for (let waited = 0; waited < ms; waited += 500) {
    if (await done()) return;
    await redis.xclaim(stream, GROUP, "aging", 0, id, "IDLE", 120_000, "JUSTID");
    await sleep(500);
  }
}

const dlqRowFor = async (stream: string) =>
  (await dlq.list(200)).entries.find((entry) => entry.stream === stream);

describe("StreamConsumer v2", () => {
  it("dead-letters after 5 failed deliveries with ids only, acks the original, replays and discards", async () => {
    const inbound = await start(
      true,
      [
        "data",
        JSON.stringify({ waMessageId: "WAM1", kind: "text", text: TEXT, phone: PHONE, jid: PHONE }),
      ],
      false,
    );
    const events = await start(
      true,
      ["data", JSON.stringify({ type: "order_paid", orderId: "o1" })],
      true,
    );
    try {
      await ageUntil(
        inbound.stream,
        inbound.id,
        async () =>
          (await pendingCount(inbound.stream)) === 0 &&
          (await dlqRowFor(inbound.stream)) !== undefined,
        60_000,
      );
      await ageUntil(
        events.stream,
        events.id,
        async () => (await dlqRowFor(events.stream)) !== undefined,
        60_000,
      );
      expect(inbound.consumer.deliveries).toBe(5);
      expect(await pendingCount(inbound.stream)).toBe(0);

      const row = await dlqRowFor(inbound.stream);
      expect(row).toMatchObject({
        entryId: inbound.id,
        group: GROUP,
        errorClass: "TypeError",
        deliveries: 5,
        waMessageId: "WAM1",
        kind: "text",
        data: null,
      });
      const raw = JSON.stringify(await redis.xrange(WA_AGENT_DLQ_STREAM, "-", "+"));
      expect(raw).not.toContain(TEXT);
      expect(raw).not.toContain(PHONE);
      // The events stream is ids and statuses only: its data is kept.
      expect((await dlqRowFor(events.stream))?.data).toContain("order_paid");

      // Replay: the entry is added again and a handler that works now acks it.
      inbound.consumer.failing = false;
      expect(await dlq.replay(row?.id ?? "")).toBe("replayed");
      await until(() => inbound.consumer.handled.length === 1, 8_000);
      await until(async () => (await pendingCount(inbound.stream)) === 0, 4_000);
      expect(inbound.consumer.handled).toHaveLength(1);
      expect(await pendingCount(inbound.stream)).toBe(0);
      expect(await dlqRowFor(inbound.stream)).toBeUndefined();

      // Discard removes the other one; a second discard finds nothing.
      const eventsRow = await dlqRowFor(events.stream);
      await dlq.discard(eventsRow?.id ?? "");
      expect(await dlqRowFor(events.stream)).toBeUndefined();
      await expect(dlq.discard(eventsRow?.id ?? "")).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await inbound.consumer.onApplicationShutdown();
      await events.consumer.onApplicationShutdown();
    }
  }, 150_000);

  it("replay reports gone when the source entry was trimmed, and keeps the dead letter", async () => {
    const dlqId =
      (await redis.xadd(
        WA_AGENT_DLQ_STREAM,
        "*",
        "stream",
        "wa:agent:test-gone",
        "id",
        "1-1",
        "group",
        GROUP,
        "errorClass",
        "Error",
        "deliveries",
        "5",
        "at",
        new Date().toISOString(),
      )) ?? "";
    expect(await dlq.replay(dlqId)).toBe("gone");
    expect(await redis.xrange(WA_AGENT_DLQ_STREAM, dlqId, dlqId)).toHaveLength(1);
    await dlq.discard(dlqId);
    await expect(dlq.replay(dlqId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("v1 mode still acks an entry whose handler threw", async () => {
    const { stream, consumer } = await start(false, ["data", JSON.stringify({ n: 1 })]);
    try {
      await until(() => consumer.deliveries === 1, 8_000);
      await until(async () => (await pendingCount(stream)) === 0, 4_000);
      expect(consumer.deliveries).toBe(1);
      expect(await pendingCount(stream)).toBe(0);
      expect(await dlqRowFor(stream)).toBeUndefined();
    } finally {
      await consumer.onApplicationShutdown();
    }
  }, 30_000);

  it("acks a malformed entry at once in v2 (it can never succeed)", async () => {
    const { stream, consumer } = await start(true, ["data", "{not json"]);
    try {
      await until(() => consumer.deliveries === 1, 8_000);
      await until(async () => (await pendingCount(stream)) === 0, 4_000);
      expect(await pendingCount(stream)).toBe(0);
      expect(await dlqRowFor(stream)).toBeUndefined();
    } finally {
      await consumer.onApplicationShutdown();
    }
  }, 30_000);
});
