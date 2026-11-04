import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/*
 * Step-2 authorisation: base64url(signupId.expiryUnix.hmac). Whoever created the row in step 1 holds
 * it; it is valid for that signup only and for 24 hours. The HMAC key is derived from a server
 * secret with a purpose label, so it cannot be replayed as any other token made from the same secret.
 */

export const EARLY_TOKEN_TTL_SECONDS = 24 * 60 * 60;

function key(secret: string): Buffer {
  return createHmac("sha256", secret).update("early-access-token-v1").digest();
}

function mac(secret: string, payload: string): string {
  return createHmac("sha256", key(secret)).update(payload).digest("base64url");
}

export function signEarlyToken(secret: string, signupId: string, now: Date): string {
  const expiry = Math.floor(now.getTime() / 1000) + EARLY_TOKEN_TTL_SECONDS;
  const payload = `${signupId}.${expiry}`;
  return Buffer.from(`${payload}.${mac(secret, payload)}`).toString("base64url");
}

export function verifyEarlyToken(
  secret: string,
  token: string | undefined,
  signupId: string,
  now: Date,
): boolean {
  if (!token || token.length > 300) return false;
  const parts = Buffer.from(token, "base64url").toString("utf8").split(".");
  const [id, expiry, signature] = parts;
  if (parts.length !== 3 || id !== signupId || !expiry || !signature) return false;
  if (!/^\d{1,12}$/.test(expiry)) return false;
  const expected = Buffer.from(mac(secret, `${id}.${expiry}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  return Number(expiry) * 1000 > now.getTime();
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 8 random base62 characters (about 47 bits); the unique key catches the rare collision. */
export function newRefCode(): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) code += BASE62[randomInt(BASE62.length)];
  return code;
}

/** Uniform random element of a price ladder (Gabor-Granger probe). */
export function pickProbe(
  ladder: readonly number[],
  pick: (max: number) => number = (max) => randomInt(max),
): number {
  const value = ladder[pick(ladder.length)];
  if (value === undefined) throw new Error("Empty price ladder");
  return value;
}

/** Each friend who joined moves you up three places; never above #1. */
export const INVITE_BOOST = 3;

export function queuePosition(rawRank: number, invitedCount: number): number {
  return Math.max(1, rawRank - INVITE_BOOST * invitedCount);
}
