import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v2";
const LEGACY_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretDecryptionError extends Error {
  constructor() {
    super("Secret could not be decrypted (wrong key, wrong context, or tampered data).");
    this.name = "SecretDecryptionError";
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new RangeError("Encryption key must be exactly 32 bytes.");
  }
}

/** Short public id of a key (first 4 bytes of its SHA-256, hex). Safe to store: it cannot recover the key. */
export function keyId(key: Buffer): string {
  assertKey(key);
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/**
 * AES-256-GCM for admin-stored secrets (AI/payment API keys).
 * Output: `v2.<keyId>.<iv>.<tag>.<ciphertext>` (base64url). `context` is bound as AAD, so a value
 * copied into another row (e.g. `ai_provider:openrouter`) fails to decrypt. The key id lets a
 * rotation tell which key sealed a value (`scripts/rotate-encryption-key`).
 */
export function encryptSecret(plaintext: string, key: Buffer, context = ""): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, keyId(key), iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

/** Id of the key that sealed `payload`; `null` for legacy `v1` values (no id) and malformed input. */
export function sealedKeyId(payload: string): string | null {
  const parts = payload.split(".");
  return parts.length === 5 && parts[0] === VERSION ? (parts[1] ?? null) : null;
}

/**
 * `key` may be a list (current key first, old keys after) during a rotation window: a `v2` value
 * uses the key whose id it names; a legacy `v1` value (no id) is tried against each key.
 */
export function decryptSecret(
  payload: string,
  key: Buffer | readonly Buffer[],
  context = "",
): string {
  const keys = Array.isArray(key) ? key : [key as Buffer];
  const parts = payload.split(".");
  let candidates: readonly Buffer[];
  let rest: string[];
  if (parts.length === 5 && parts[0] === VERSION) {
    candidates = keys.filter((candidate) => keyId(candidate) === parts[1]);
    rest = parts.slice(2);
  } else if (parts.length === 4 && parts[0] === LEGACY_VERSION) {
    candidates = keys;
    rest = parts.slice(1);
  } else {
    throw new SecretDecryptionError();
  }
  const [ivPart = "", tagPart = "", dataPart = ""] = rest;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptionError();
  }
  for (const candidate of candidates) {
    assertKey(candidate);
    try {
      const decipher = createDecipheriv(ALGORITHM, candidate, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(dataPart, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Wrong key for a legacy value: try the next one.
    }
  }
  throw new SecretDecryptionError();
}

/** For admin screens: `sk-…f9a2`. Never returns more than the last 4 characters. */
export function maskSecret(secret: string): string {
  return secret.length <= 8 ? "••••" : `${secret.slice(0, 3)}…${secret.slice(-4)}`;
}

/** Decodes a base64 `ENCRYPTION_KEY` (the env schemas of the api and worker validate the length). */
export function decodeEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  assertKey(key);
  return key;
}

// --- Unsubscribe tokens (Phase 3, Task 3.14) ------------------------------------------------------------

const UNSUBSCRIBE_PURPOSE = "marketing_unsubscribe";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function unsubscribeSignature(userId: string, key: Buffer): string {
  assertKey(key);
  return createHmac("sha256", key)
    .update(`${UNSUBSCRIBE_PURPOSE}:${userId}`)
    .digest("base64url");
}

/**
 * The link token of a marketing mail: the user id and an HMAC over `purpose:userId`. It has no expiry
 * on purpose (an old mail must still unsubscribe), and it can do one thing only: turn marketing off.
 */
export function signUnsubscribeToken(userId: string, key: Buffer): string {
  return `${userId}.${unsubscribeSignature(userId, key)}`;
}

/** The user id a valid unsubscribe token names, or `null` for anything else. */
export function verifyUnsubscribeToken(token: string, key: Buffer): string | null {
  const [userId, signature, ...rest] = token.split(".");
  if (userId === undefined || signature === undefined || rest.length > 0) return null;
  if (!UUID_PATTERN.test(userId)) return null;
  const expected = Buffer.from(unsubscribeSignature(userId, key));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
