import { describe, expect, it } from "vitest";

import { ALERT_KINDS } from "../src/billing.js";
import { ALERT_KIND_PERMISSION } from "../src/permissions.js";
import { WA_AGENT_EVENTS_STREAM } from "../src/schemas/phone.js";
import { waAgentEventSchema, waAgentOrderKey, waAgentRxKey } from "../src/schemas/wa-agent.js";

const ID = "018f0000-0000-7000-8000-000000000001";

describe("wa:agent:events", () => {
  it("accepts the five events and nothing else", () => {
    for (const event of [
      { type: "order_paid", userId: ID, orderId: ID },
      { type: "payment_rejected", userId: ID, orderId: ID },
      { type: "payment_resubmit", userId: ID, orderId: ID },
      { type: "rx_done", rxId: ID },
      { type: "rx_failed", rxId: ID },
    ]) {
      expect(waAgentEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(true);
    }
    for (const bad of [
      { type: "order_paid", orderId: ID },
      { type: "rx_done" },
      { type: "rx_done", rxId: "nope" },
      { type: "refund", userId: ID, orderId: ID },
      null,
    ]) {
      expect(waAgentEventSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("names its stream and keys like the other agent streams", () => {
    expect(WA_AGENT_EVENTS_STREAM).toBe("wa:agent:events");
    expect(waAgentOrderKey(ID)).toBe(`wa:agent:order:${ID}`);
    expect(waAgentRxKey(ID)).toBe(`wa:agent:rx:${ID}`);
  });
});

describe("the handoff alert kind", () => {
  it("is its own kind, shown to whoever may read the inbox", () => {
    expect(ALERT_KINDS).toContain("wa_agent.handoff");
    expect(ALERT_KIND_PERMISSION["wa_agent.handoff"]).toBe("wa_agent.inbox");
  });
});
