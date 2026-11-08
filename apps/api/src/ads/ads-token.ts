import { createHmac, timingSafeEqual } from "node:crypto";

import { AD_CHANNELS, type AdChannel } from "@wasfa/shared/ads";

/*
 * The signed slot token (docs/ADS.md §5): base64url(creativeId.placement.day.channel.expiryUnix.hmac).
 * It carries no visitor id and no page URL. The impression beacon and the `/a/<token>` click redirect
 * both read it; it expires after 24 hours. The HMAC key is derived from a server secret with a
 * purpose label, so a token cannot be replayed as any other token made from the same secret.
 */

export const AD_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 400;

export interface AdTokenClaims {
  creativeId: string;
  placement: string;
  /** UTC day (`YYYY-MM-DD`) the token was issued; the counters of that day are credited. */
  day: string;
  channel: AdChannel;
}

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update("ads-slot-token-v1").digest();
}

function mac(secret: string, payload: string): string {
  return createHmac("sha256", key(secret)).update(payload).digest("base64url");
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function signAdToken(secret: string, claims: AdTokenClaims, now: Date): string {
  const expiry = Math.floor(now.getTime() / 1000) + AD_TOKEN_TTL_SECONDS;
  const payload = [claims.creativeId, claims.placement, claims.day, claims.channel, expiry].join(
    ".",
  );
  return Buffer.from(`${payload}.${mac(secret, payload)}`).toString("base64url");
}

/** The claims of a genuine, unexpired token, or `null` (never throws on hostile input). */
export function verifyAdToken(
  secret: string,
  token: string | undefined,
  now: Date,
): AdTokenClaims | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = Buffer.from(token, "base64url").toString("utf8").split(".");
  // The placement key contains dots, so the fixed fields are counted from both ends.
  if (parts.length < 6) return null;
  const signature = parts.pop();
  const expiry = parts.pop();
  const channel = parts.pop();
  const day = parts.pop();
  const creativeId = parts.shift();
  const placement = parts.join(".");
  if (!signature || !expiry || !channel || !day || !creativeId || !placement) return null;
  if (!/^\d{1,12}$/.test(expiry)) return null;
  if (!AD_CHANNELS.includes(channel as AdChannel)) return null;
  const payload = [creativeId, placement, day, channel, expiry].join(".");
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(expiry) * 1000 <= now.getTime()) return null;
  return { creativeId, placement, day, channel: channel as AdChannel };
}
