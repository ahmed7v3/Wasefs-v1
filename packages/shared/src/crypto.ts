import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
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

/**
 * AES-256-GCM for admin-stored secrets (AI/payment API keys).
 * Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). `context` is bound as AAD, so a value
 * copied into another row (e.g. `ai_provider:openrouter`) fails to decrypt.
 */
export function encryptSecret(plaintext: string, key: Buffer, context = ""): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptSecret(payload: string, key: Buffer, context = ""): string {
  assertKey(key);
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretDecryptionError();
  }
  const [, ivPart = "", tagPart = "", dataPart = ""] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptionError();
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataPart, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    throw new SecretDecryptionError();
  }
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
