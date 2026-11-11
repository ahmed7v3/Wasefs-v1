import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Secrets of Publishing API keys. A key is `wsk_<env>_<keyId>_<secret>`; the database keeps only
 * HMAC-SHA256(pepper, secret) in hex. The pepper is HKDF-derived from the app encryption key with the
 * purpose `publishing-api-key`, so every API instance computes the same value and nothing extra is stored.
 */

/** No look-alikes (0/O, 1/l/I): keys are copied by hand sometimes. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export const KEY_ID_LENGTH = 12;
export const SECRET_LENGTH = 48;

/** Uniform pick from the alphabet: bytes at or above the largest multiple of its size are rejected (no modulo bias). */
function randomString(length: number): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export const generateKeyId = (): string => randomString(KEY_ID_LENGTH);
export const generateSecret = (): string => randomString(SECRET_LENGTH);

export function derivePepper(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey, "", "publishing-api-key", 32));
}

export function hashSecret(pepper: Buffer, secret: string): string {
  return createHmac("sha256", pepper).update(secret).digest("hex");
}

/** Constant-time comparison of a presented secret with a stored hash. */
export function secretMatchesHash(pepper: Buffer, secret: string, storedHash: string): boolean {
  const given = Buffer.from(hashSecret(pepper, secret), "hex");
  const wanted = Buffer.from(storedHash, "hex");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export interface KeySecretState {
  secretHash: string;
  prevSecretHash: string | null;
  prevValidUntil: Date | null;
}

/**
 * Current secret, or the previous one while the rotation grace runs. Both comparisons always execute
 * so timing does not reveal which one matched.
 */
export function verifyKeySecret(
  pepper: Buffer,
  secret: string,
  state: KeySecretState,
  now: Date,
): boolean {
  const current = secretMatchesHash(pepper, secret, state.secretHash);
  const previous =
    state.prevSecretHash !== null &&
    state.prevValidUntil !== null &&
    state.prevValidUntil.getTime() > now.getTime() &&
    secretMatchesHash(pepper, secret, state.prevSecretHash);
  return current || previous;
}
