import { describe, expect, it } from "vitest";

import { webhookBackoffMs, webhookSignature } from "../src/publishing/webhook.job.js";

describe("publishing webhook delivery", () => {
  it("signs timestamp and exact body with the documented HMAC format", () => {
    expect(webhookSignature("secret", "1700000000", '{"event":"content.created"}')).toBe(
      "c5de554bfb94c4d22212791454a07bc27928b129e29b248f58af43ac829a782f",
    );
  });

  it("uses bounded exponential delays for seven retries", () => {
    expect(webhookBackoffMs(1)).toBe(60_000);
    expect(webhookBackoffMs(2)).toBe(300_000);
    expect(webhookBackoffMs(7)).toBe(43_200_000);
    expect(webhookBackoffMs(99)).toBe(43_200_000);
  });
});
