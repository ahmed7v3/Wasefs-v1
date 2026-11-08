import { adCounterKey, parseAdCounterKey } from "@wasfa/shared/ads";
import { describe, expect, it } from "vitest";

import {
  AD_TOKEN_TTL_SECONDS,
  signAdToken,
  utcDay,
  verifyAdToken,
  type AdTokenClaims,
} from "../src/ads/ads-token.js";

const SECRET = "s".repeat(40);
const NOW = new Date("2026-11-08T12:00:00Z");
const CLAIMS: AdTokenClaims = {
  creativeId: "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a10",
  placement: "article.inline.1",
  day: utcDay(NOW),
  channel: "web",
};

describe("ad token", () => {
  it("round-trips the claims, including a dotted placement key", () => {
    const token = signAdToken(SECRET, CLAIMS, NOW);
    expect(verifyAdToken(SECRET, token, NOW)).toEqual(CLAIMS);
  });

  it("carries no user data: only creative, placement, day and channel", () => {
    const token = signAdToken(SECRET, CLAIMS, NOW);
    const text = Buffer.from(token, "base64url").toString("utf8");
    expect(text.split(".").length).toBe(CLAIMS.placement.split(".").length + 5);
  });

  it("expires after 24 hours", () => {
    const token = signAdToken(SECRET, CLAIMS, NOW);
    const justBefore = new Date(NOW.getTime() + (AD_TOKEN_TTL_SECONDS - 1) * 1000);
    const atExpiry = new Date(NOW.getTime() + AD_TOKEN_TTL_SECONDS * 1000);
    expect(verifyAdToken(SECRET, token, justBefore)).not.toBeNull();
    expect(verifyAdToken(SECRET, token, atExpiry)).toBeNull();
  });

  it("rejects another secret, a tampered payload and garbage", () => {
    const token = signAdToken(SECRET, CLAIMS, NOW);
    expect(verifyAdToken("x".repeat(40), token, NOW)).toBeNull();
    const text = Buffer.from(token, "base64url").toString("utf8");
    const forged = Buffer.from(text.replace("article.inline.1", "article.inline.2")).toString(
      "base64url",
    );
    expect(verifyAdToken(SECRET, forged, NOW)).toBeNull();
    for (const bad of [
      undefined,
      "",
      "abc",
      "a".repeat(500),
      Buffer.from("a.b.c").toString("base64url"),
    ]) {
      expect(verifyAdToken(SECRET, bad, NOW)).toBeNull();
    }
  });

  it("rejects an unknown channel even with a valid signature shape", () => {
    const token = signAdToken(SECRET, { ...CLAIMS, channel: "whatsapp" }, NOW);
    expect(verifyAdToken(SECRET, token, NOW)?.channel).toBe("whatsapp");
    const text = Buffer.from(token, "base64url").toString("utf8").replace(".whatsapp.", ".sms.");
    expect(verifyAdToken(SECRET, Buffer.from(text).toString("base64url"), NOW)).toBeNull();
  });
});

describe("counter keys", () => {
  it("round-trips the key the worker folds", () => {
    const key = adCounterKey({
      creativeId: CLAIMS.creativeId,
      placement: CLAIMS.placement,
      day: CLAIMS.day,
      channel: "web",
      kind: "i",
    });
    expect(key).toBe(`ads:c:${CLAIMS.creativeId}:article.inline.1:2026-11-08:web:i`);
    expect(parseAdCounterKey(key)).toEqual({
      creativeId: CLAIMS.creativeId,
      placement: CLAIMS.placement,
      day: CLAIMS.day,
      channel: "web",
      kind: "i",
    });
    expect(parseAdCounterKey("ads:c:garbage")).toBeNull();
  });
});
