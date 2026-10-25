import { describe, expect, it } from "vitest";

import {
  REVALIDATE_HEADER,
  ReplayCache,
  signRevalidation,
  verifyRevalidation,
} from "../../src/content/revalidate.js";
import { REVALIDATE_WINDOW_SECONDS, revalidateRequestSchema } from "../../src/schemas/content.js";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000;
const body = JSON.stringify({ tags: ["content:item:1"], timestamp: NOW });

const verify = (overrides: Partial<Parameters<typeof verifyRevalidation>[0]> = {}) =>
  verifyRevalidation({
    secret: SECRET,
    signature: signRevalidation(SECRET, NOW, body),
    timestamp: NOW,
    body,
    now: NOW,
    windowSeconds: REVALIDATE_WINDOW_SECONDS,
    ...overrides,
  });

describe("signRevalidation", () => {
  it("is sha256=<64 hex> and deterministic", () => {
    const signature = signRevalidation(SECRET, NOW, body);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signRevalidation(SECRET, NOW, body)).toBe(signature);
  });

  it("changes with the secret, the timestamp and the body", () => {
    const base = signRevalidation(SECRET, NOW, body);
    expect(signRevalidation(`${SECRET}x`, NOW, body)).not.toBe(base);
    expect(signRevalidation(SECRET, NOW + 1, body)).not.toBe(base);
    expect(signRevalidation(SECRET, NOW, `${body} `)).not.toBe(base);
  });

  it("uses the documented header name", () => {
    expect(REVALIDATE_HEADER).toBe("x-revalidate-signature");
  });

  it("signs the body shape the API sends", () => {
    expect(revalidateRequestSchema.safeParse(JSON.parse(body)).success).toBe(true);
  });
});

describe("verifyRevalidation", () => {
  it("accepts a fresh, correctly signed request", () => {
    expect(verify()).toEqual({ ok: true });
  });

  it("rejects a tampered body, timestamp or secret", () => {
    expect(verify({ body: body.replace("item:1", "item:2") })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(verify({ timestamp: NOW + 1 })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verify({ secret: `${SECRET}!` })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects stale and future timestamps beyond the window, accepts the edge", () => {
    const sign = (timestamp: number) => signRevalidation(SECRET, timestamp, body);
    expect(verify({ now: NOW + REVALIDATE_WINDOW_SECONDS })).toEqual({ ok: true });
    expect(verify({ now: NOW + REVALIDATE_WINDOW_SECONDS + 1 })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(verify({ timestamp: NOW + 400, signature: sign(NOW + 400) })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(verify({ timestamp: NOW + 100, signature: sign(NOW + 100) })).toEqual({ ok: true });
  });

  it("rejects malformed signatures without throwing", () => {
    for (const signature of [
      "",
      "sha256=",
      "sha256=zz",
      "sha1=abcd",
      "sha256=" + "a".repeat(63),
      "sha256=" + "a".repeat(65),
      "abc",
    ]) {
      expect(verify({ signature }), signature).toMatchObject({ ok: false });
    }
    expect(verify({ timestamp: Number.NaN })).toEqual({ ok: false, reason: "malformed" });
  });

  it("accepts upper-case hex", () => {
    const signature = signRevalidation(SECRET, NOW, body);
    expect(verify({ signature: `sha256=${signature.slice(7).toUpperCase()}` })).toEqual({
      ok: true,
    });
  });
});

describe("ReplayCache", () => {
  it("accepts a signature once and refuses it again inside the window", () => {
    const cache = new ReplayCache();
    expect(cache.remember("sig-a", 1_000, 300_000)).toBe(true);
    expect(cache.remember("sig-a", 2_000, 300_000)).toBe(false);
    expect(cache.remember("sig-b", 2_000, 300_000)).toBe(true);
  });

  it("forgets a signature after its expiry and prunes on insert", () => {
    const cache = new ReplayCache();
    cache.remember("old", 0, 1_000);
    cache.remember("kept", 0, 100_000);
    expect(cache.size).toBe(2);
    expect(cache.remember("new", 5_000, 1_000)).toBe(true);
    expect(cache.size).toBe(2);
    expect(cache.remember("old", 6_000, 1_000)).toBe(true);
  });

  it("stays bounded under a flood of distinct signatures", () => {
    const cache = new ReplayCache(50);
    for (let i = 0; i < 500; i += 1) cache.remember(`sig-${String(i)}`, 0, 1_000_000);
    expect(cache.size).toBeLessThanOrEqual(50);
  });

  it("works together with verify: the same valid request cannot be replayed", () => {
    const cache = new ReplayCache();
    const signature = signRevalidation(SECRET, NOW, body);
    const handle = (): "ok" | "replay" | "rejected" => {
      if (!verify({ signature }).ok) return "rejected";
      return cache.remember(signature, NOW * 1000, REVALIDATE_WINDOW_SECONDS * 1000)
        ? "ok"
        : "replay";
    };
    expect(handle()).toBe("ok");
    expect(handle()).toBe("replay");
  });
});
