import { WA_AGENT_EVENTS_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentEventSchema, waAgentRxKey } from "@wasfa/shared/schemas/wa-agent";
import { describe, expect, it } from "vitest";

import { customerWhatsappOn } from "../src/notifications/customer-channel.js";
import { pushWaAgentEvent } from "../src/notifications/wa-agent-events.js";
import { createRxPublisher } from "../src/rx/events.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * The worker's side of the WhatsApp agent follow-ups that needs no database: the rx publisher only
 * tells the agent about readings the agent started, and the event is a valid `wa:agent:events` entry.
 */

const RX_ID = "018f0000-0000-7000-8000-0000000000d1";

class FakeRedis {
  readonly keys = new Set<string>();
  readonly stream: Array<{ stream: string; data: unknown }> = [];

  incr = () => Promise.resolve(1);
  expire = () => Promise.resolve(1);
  set = () => Promise.resolve("OK");
  publish = () => Promise.resolve(1);
  exists = (key: string) => Promise.resolve(this.keys.has(key) ? 1 : 0);
  xadd = (stream: string, ...args: string[]) => {
    this.stream.push({ stream, data: JSON.parse(args.at(-1) ?? "null") });
    return Promise.resolve("1-0");
  };
}

const logger = { warn: () => undefined, info: () => undefined } as unknown as Logger;
const publisher = (redis: FakeRedis) => createRxPublisher(redis as unknown as Redis, RX_ID, logger);

describe("rx events for the WhatsApp agent", () => {
  it("pushes rx_done only for a reading the agent started", async () => {
    const web = new FakeRedis();
    await publisher(web).done("done");
    expect(web.stream).toHaveLength(0);

    const agent = new FakeRedis();
    agent.keys.add(waAgentRxKey(RX_ID));
    await publisher(agent).done("done");
    expect(agent.stream).toEqual([
      { stream: WA_AGENT_EVENTS_STREAM, data: { type: "rx_done", rxId: RX_ID } },
    ]);
  });

  it("tells the agent a refunded or failed reading could not be read", async () => {
    for (const end of [
      (p: ReturnType<typeof publisher>) => p.done("refunded"),
      (p: ReturnType<typeof publisher>) => p.failed("WSF-1"),
    ]) {
      const agent = new FakeRedis();
      agent.keys.add(waAgentRxKey(RX_ID));
      await end(publisher(agent));
      expect(agent.stream.map((entry) => entry.data)).toEqual([{ type: "rx_failed", rxId: RX_ID }]);
    }
  });

  it("carries the reason and the observed credit outcome of a failed reading", async () => {
    const agent = new FakeRedis();
    agent.keys.add(waAgentRxKey(RX_ID));
    await publisher(agent).done("refunded", undefined, {
      reason: "unreadable_image",
      creditsReturned: true,
    });
    await publisher(agent).failed("WSF-1", { reason: "internal", creditsReturned: false });
    expect(agent.stream.map((entry) => entry.data)).toEqual([
      { type: "rx_failed", rxId: RX_ID, reason: "unreadable_image", creditsReturned: true },
      { type: "rx_failed", rxId: RX_ID, reason: "internal", creditsReturned: false },
    ]);
    for (const entry of agent.stream) {
      expect(waAgentEventSchema.safeParse(entry.data).success).toBe(true);
    }
  });

  it("also tells the agent when a wa_outbox route waits (v2 starts write no Redis key)", async () => {
    const web = new FakeRedis();
    const routed = createRxPublisher(web as unknown as Redis, RX_ID, logger, undefined, () =>
      Promise.resolve(true),
    );
    await routed.done("done");
    expect(web.stream).toHaveLength(1);
  });

  it("writes entries the api consumer accepts", async () => {
    const redis = new FakeRedis();
    await pushWaAgentEvent(redis as unknown as Redis, {
      type: "payment_rejected",
      userId: "018f0000-0000-7000-8000-0000000000a1",
      orderId: "018f0000-0000-7000-8000-0000000000b1",
    });
    expect(waAgentEventSchema.safeParse(redis.stream[0]?.data).success).toBe(true);
  });
});

describe("customerWhatsappOn", () => {
  it("is the one rule both the customer-message path and the agent follow-up use", () => {
    expect(customerWhatsappOn(true, "201012345678@s.whatsapp.net")).toBe(true);
    expect(customerWhatsappOn(false, "201012345678@s.whatsapp.net")).toBe(false);
    expect(customerWhatsappOn(true, null)).toBe(false);
  });
});
