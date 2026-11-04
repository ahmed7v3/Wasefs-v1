import { describe, expect, it } from "vitest";

import {
  decodeHeaderText,
  extractEarlyContext,
  isBotUserAgent,
  parseBrowser,
  parseDevice,
  parseOs,
  referrerHostOf,
  visitorHash,
} from "../src/early-access/early-context.js";
import {
  EARLY_TOKEN_TTL_SECONDS,
  newRefCode,
  pickProbe,
  queuePosition,
  signEarlyToken,
  verifyEarlyToken,
} from "../src/early-access/early-token.js";

const SECRET = "x".repeat(40);
const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";

describe("early-access context", () => {
  it("reads Cloudflare geo headers and rounds coordinates to two decimals", () => {
    const context = extractEarlyContext(
      {
        "cf-ipcountry": "eg",
        "cf-ipcity": "Cairo",
        "cf-region": "Cairo Governorate",
        "cf-timezone": "Africa/Cairo",
        "cf-iplatitude": "30.04442",
        "cf-iplongitude": "31.235712",
        "user-agent": ANDROID_CHROME,
      },
      { referrer: "https://www.google.com/search?q=wasfa", lang: "ar-EG" },
    );
    expect(context).toEqual({
      country: "EG",
      region: "Cairo Governorate",
      city: "Cairo",
      timezone: "Africa/Cairo",
      latApprox: 30.04,
      lonApprox: 31.24,
      device: "mobile",
      browser: "Chrome",
      os: "Android",
      lang: "ar-EG",
      referrerHost: "www.google.com",
    });
  });

  it("ignores pseudo countries, bad coordinates and bad timezones; falls back to client hints", () => {
    const context = extractEarlyContext(
      {
        "cf-ipcountry": "XX",
        "cf-iplatitude": "999",
        "cf-iplongitude": "abc",
        "cf-timezone": "bad zone!",
        "accept-language": "ar-SA,ar;q=0.9,en;q=0.8",
      },
      { timezone: "Asia/Riyadh", screenW: 390 },
    );
    expect(context.country).toBeNull();
    expect(context.latApprox).toBeNull();
    expect(context.lonApprox).toBeNull();
    expect(context.timezone).toBe("Asia/Riyadh");
    expect(context.lang).toBe("ar-SA");
    expect(context.device).toBe("mobile");
    expect(context.browser).toBeNull();
  });

  it("decodes percent-encoded and latin1-mangled city names", () => {
    expect(decodeHeaderText("%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9")).toBe("القاهرة");
    const mangled = Buffer.from("Zürich", "utf8").toString("latin1");
    expect(decodeHeaderText(mangled)).toBe("Zürich");
    expect(decodeHeaderText("São Paulo")).toBe("São Paulo");
    expect(decodeHeaderText("   ")).toBeNull();
  });

  it("parses device, browser and OS from the user agent", () => {
    expect(parseDevice(IPHONE)).toBe("mobile");
    expect(parseDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(parseDevice("Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/120")).toBe("tablet");
    expect(parseDevice(WINDOWS_EDGE)).toBe("desktop");
    expect(parseBrowser(WINDOWS_EDGE)).toBe("Edge");
    expect(parseBrowser(IPHONE)).toBe("Safari");
    expect(parseOs(IPHONE)).toBe("iOS");
    expect(parseOs(WINDOWS_EDGE)).toBe("Windows");
  });

  it("keeps only the host of a referrer", () => {
    expect(referrerHostOf("https://t.co/abc?x=1#y")).toBe("t.co");
    expect(referrerHostOf("not a url")).toBeNull();
    expect(referrerHostOf(undefined)).toBeNull();
  });

  it("flags bots", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("WhatsApp link preview")).toBe(true);
    expect(isBotUserAgent(ANDROID_CHROME)).toBe(false);
    expect(isBotUserAgent(undefined)).toBe(false);
  });

  it("hashes visitors with a salt that changes every UTC day and never contains the IP", () => {
    const day1 = new Date("2026-11-01T10:00:00Z");
    const sameDay = new Date("2026-11-01T23:59:00Z");
    const day2 = new Date("2026-11-02T00:01:00Z");
    const a = visitorHash(SECRET, "203.0.113.7", IPHONE, day1);
    expect(a).toBe(visitorHash(SECRET, "203.0.113.7", IPHONE, sameDay));
    expect(a).not.toBe(visitorHash(SECRET, "203.0.113.7", IPHONE, day2));
    expect(a).not.toBe(visitorHash(SECRET, "203.0.113.8", IPHONE, day1));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203");
  });
});

describe("early-access token", () => {
  const now = new Date("2026-11-04T12:00:00Z");

  it("verifies for the signup it was made for", () => {
    const token = signEarlyToken(SECRET, ID, now);
    expect(token.length).toBeLessThan(300);
    expect(verifyEarlyToken(SECRET, token, ID, now)).toBe(true);
  });

  it("rejects another signup id, another secret, and a missing token", () => {
    const token = signEarlyToken(SECRET, ID, now);
    expect(verifyEarlyToken(SECRET, token, OTHER_ID, now)).toBe(false);
    expect(verifyEarlyToken("y".repeat(40), token, ID, now)).toBe(false);
    expect(verifyEarlyToken(SECRET, undefined, ID, now)).toBe(false);
    expect(verifyEarlyToken(SECRET, "", ID, now)).toBe(false);
    expect(verifyEarlyToken(SECRET, "garbage", ID, now)).toBe(false);
  });

  it("rejects a tampered expiry or signature", () => {
    const token = signEarlyToken(SECRET, ID, now);
    const [id, expiry, signature] = Buffer.from(token, "base64url").toString("utf8").split(".");
    const forge = (parts: (string | undefined)[]) =>
      Buffer.from(parts.join(".")).toString("base64url");
    const later = String(Number(expiry) + 86_400);
    expect(verifyEarlyToken(SECRET, forge([id, later, signature]), ID, now)).toBe(false);
    expect(verifyEarlyToken(SECRET, forge([id, expiry, `${signature}x`]), ID, now)).toBe(false);
    expect(verifyEarlyToken(SECRET, forge([id, expiry]), ID, now)).toBe(false);
  });

  it("expires after 24 hours", () => {
    const token = signEarlyToken(SECRET, ID, now);
    const justBefore = new Date(now.getTime() + (EARLY_TOKEN_TTL_SECONDS - 1) * 1000);
    const justAfter = new Date(now.getTime() + (EARLY_TOKEN_TTL_SECONDS + 1) * 1000);
    expect(verifyEarlyToken(SECRET, token, ID, justBefore)).toBe(true);
    expect(verifyEarlyToken(SECRET, token, ID, justAfter)).toBe(false);
  });
});

describe("early-access ref codes, probe and queue position", () => {
  it("makes 8-character base62 ref codes", () => {
    const codes = new Set(Array.from({ length: 50 }, () => newRefCode()));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^[0-9A-Za-z]{8}$/);
  });

  it("picks every ladder element with equal chance and nothing else", () => {
    const ladder = [4900, 7900, 9900];
    expect(pickProbe(ladder, () => 0)).toBe(4900);
    expect(pickProbe(ladder, (max) => max - 1)).toBe(9900);
    const seen = new Set(Array.from({ length: 200 }, () => pickProbe(ladder)));
    expect([...seen].sort()).toEqual([4900, 7900, 9900]);
    expect(() => pickProbe([])).toThrow();
  });

  it("moves each inviter up three places and never above first", () => {
    expect(queuePosition(10, 0)).toBe(10);
    expect(queuePosition(10, 2)).toBe(4);
    expect(queuePosition(10, 3)).toBe(1);
    expect(queuePosition(2, 5)).toBe(1);
  });
});
