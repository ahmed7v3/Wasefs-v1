import { describe, expect, it } from "vitest";

import { parseUserAgent } from "../src/lib/user-agent";

const UAS = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0",
};

describe("parseUserAgent", () => {
  it.each([
    [UAS.chromeWindows, "Chrome", "Windows"],
    [UAS.edgeWindows, "Edge", "Windows"],
    [UAS.firefoxLinux, "Firefox", "Linux"],
    [UAS.safariMac, "Safari", "macOS"],
    [UAS.safariIphone, "Safari", "iOS"],
    [UAS.chromeAndroid, "Chrome", "Android"],
    [UAS.chromeIos, "Chrome", "iOS"],
    [UAS.samsung, "Samsung Internet", "Android"],
    [UAS.opera, "Opera", "Windows"],
  ])("reads user agent %#", (userAgent, browser, os) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser, os });
  });

  it("answers null for what it cannot recognise", () => {
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
    expect(parseUserAgent("")).toEqual({ browser: null, os: null });
    expect(parseUserAgent("curl/8.4.0")).toEqual({ browser: null, os: null });
  });
});
