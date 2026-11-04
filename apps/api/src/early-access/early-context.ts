import { createHash, createHmac } from "node:crypto";

import type { EarlyDevice } from "@wasfa/shared/schemas/early-access";
import type { IncomingHttpHeaders } from "node:http";

/*
 * What we learn about a visitor without asking (docs/EARLY-ACCESS-PLAN.md D2): Cloudflare location
 * headers, the user agent and the page's own hints. Pure functions, no I/O. The IP is only ever used
 * as an input of a daily-salted hash; it is never returned or stored.
 */

export interface EarlyContext {
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  latApprox: number | null;
  lonApprox: number | null;
  device: EarlyDevice | null;
  browser: string | null;
  os: string | null;
  lang: string | null;
  referrerHost: string | null;
}

export interface EarlyClientHints {
  referrer?: string | undefined;
  timezone?: string | undefined;
  lang?: string | undefined;
  screenW?: number | undefined;
}

const COUNTRY = /^[A-Z]{2}$/;
// Cloudflare "unknown" and "Tor" pseudo countries.
const NO_COUNTRY = new Set(["XX", "T1"]);
const TIMEZONE = /^[A-Za-z0-9_+/-]{1,64}$/;
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
const BOT = /bot|crawler|spider|preview|headless|lighthouse/i;

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Cloudflare may send percent-encoded text, or UTF-8 bytes read as latin1; both end up as plain text. */
export function decodeHeaderText(raw: string | undefined, max = 100): string | null {
  if (raw === undefined) return null;
  let text = raw.trim();
  if (text === "") return null;
  if (text.includes("%")) {
    try {
      text = decodeURIComponent(text);
    } catch {
      // Not valid percent-encoding: keep it as sent.
    }
  }
  // UTF-8 read as latin1 looks like a lead character (U+00C2..U+00F4) followed by a continuation one.
  if (/[Â-ô][\u0080-¿]/.test(text) && [...text].every((char) => char.charCodeAt(0) <= 0xff)) {
    const fixed = Buffer.from(text, "latin1").toString("utf8");
    if (!fixed.includes("�")) text = fixed;
  }
  // eslint-disable-next-line no-control-regex -- strips control characters from a header we do not control
  text = text.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return text === "" ? null : text.slice(0, max);
}

function countryOf(headers: IncomingHttpHeaders): string | null {
  const value = headerValue(headers, "cf-ipcountry")?.trim().toUpperCase();
  return value && COUNTRY.test(value) && !NO_COUNTRY.has(value) ? value : null;
}

/** Two decimals is about 1 km: city-level, deliberately not a position. */
function coordinate(raw: string | undefined, limit: number): number | null {
  if (raw === undefined) return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return Math.round(value * 100) / 100;
}

export function parseDevice(ua: string, screenW?: number): EarlyDevice | null {
  if (ua !== "") {
    if (/ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
      return "tablet";
    }
    if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
    return "desktop";
  }
  if (screenW === undefined) return null;
  if (screenW < 600) return "mobile";
  return screenW < 1024 ? "tablet" : "desktop";
}

/** Order matters: Edge, Opera and in-app browsers all also say "Chrome" or "Safari". */
export function parseBrowser(ua: string): string | null {
  if (ua === "") return null;
  if (/instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV/.test(ua)) return "Facebook";
  if (/edg(e|a|ios)?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/chrome|chromium|crios/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Other";
}

export function parseOs(ua: string): string | null {
  if (ua === "") return null;
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Other";
}

export function isBotUserAgent(ua: string | undefined): boolean {
  return ua !== undefined && BOT.test(ua);
}

/** Host only: the path and query of a referrer can carry anything. */
export function referrerHostOf(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host === "" ? null : host.slice(0, 200);
  } catch {
    return null;
  }
}

function langOf(client: string | undefined, acceptLanguage: string | undefined): string | null {
  const own = client?.trim();
  if (own && LANG.test(own)) return own.slice(0, 35);
  const first = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim();
  return first && LANG.test(first) ? first.slice(0, 35) : null;
}

export function extractEarlyContext(
  headers: IncomingHttpHeaders,
  client: EarlyClientHints = {},
): EarlyContext {
  const ua = headerValue(headers, "user-agent") ?? "";
  const headerZone = decodeHeaderText(headerValue(headers, "cf-timezone"), 64);
  const clientZone = client.timezone?.trim();
  const timezone =
    headerZone && TIMEZONE.test(headerZone)
      ? headerZone
      : clientZone && TIMEZONE.test(clientZone)
        ? clientZone
        : null;
  return {
    country: countryOf(headers),
    region: decodeHeaderText(headerValue(headers, "cf-region")),
    city: decodeHeaderText(headerValue(headers, "cf-ipcity")),
    timezone,
    latApprox: coordinate(headerValue(headers, "cf-iplatitude"), 90),
    lonApprox: coordinate(headerValue(headers, "cf-iplongitude"), 180),
    device: parseDevice(ua, client.screenW),
    browser: parseBrowser(ua),
    os: parseOs(ua),
    lang: langOf(client.lang, headerValue(headers, "accept-language")),
    referrerHost: referrerHostOf(client.referrer),
  };
}

/**
 * Unique-visitor key: sha256(dailySalt + ip + ua). The salt is an HMAC of the UTC date, so the same
 * person hashes differently every day and yesterday's hashes cannot be linked to today's.
 */
export function visitorHash(secret: string, ip: string, ua: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  const salt = createHmac("sha256", secret).update(`early-visitor:${day}`).digest("hex");
  return createHash("sha256").update(`${salt}${ip}${ua}`).digest("hex");
}
