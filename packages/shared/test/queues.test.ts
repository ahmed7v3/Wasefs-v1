import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_STALE_AFTER_MS,
  QUEUE_NAMES,
  isQueueName,
  parseJobPayload,
  workerStatus,
} from "../src/queues.js";

describe("queue registry", () => {
  it("lists the system queue", () => {
    expect(QUEUE_NAMES).toContain("system");
    expect(isQueueName("system")).toBe(true);
    expect(isQueueName("constructor")).toBe(false);
  });
});

describe("parseJobPayload", () => {
  it("applies defaults for a valid payload", () => {
    expect(parseJobPayload("system", "system.heartbeat", {})).toEqual({
      ok: true,
      data: { source: "scheduler" },
    });
  });

  it("rejects an invalid payload naming the field but never echoing the value", () => {
    const result = parseJobPayload("system", "system.heartbeat", { source: "ali@example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("system.heartbeat");
      expect(result.reason).toContain("source");
      expect(result.reason).not.toContain("ali@example.com");
    }
  });

  it("rejects non-object payloads and unregistered jobs", () => {
    expect(parseJobPayload("system", "system.heartbeat", null).ok).toBe(false);
    const unknown = parseJobPayload("system", "constructor" as "system.heartbeat", {});
    expect(unknown).toMatchObject({ ok: false });
  });
});

describe("workerStatus", () => {
  const now = 1_800_000_000_000;

  it("is ok for a fresh beat and at the 10 minute boundary", () => {
    expect(workerStatus(String(now - 1_000), now)).toBe("ok");
    expect(workerStatus(String(now - HEARTBEAT_STALE_AFTER_MS), now)).toBe("ok");
  });

  it("is stale after 10 minutes", () => {
    expect(workerStatus(String(now - HEARTBEAT_STALE_AFTER_MS - 1), now)).toBe("stale");
  });

  it("is stale when missing, garbage, or from the far future", () => {
    expect(workerStatus(null, now)).toBe("stale");
    expect(workerStatus("not-a-number", now)).toBe("stale");
    expect(workerStatus(String(now + 3_600_000), now)).toBe("stale");
  });
});
