import { createCipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SecretDecryptionError,
  decryptSecret,
  encryptSecret,
  keyId,
  maskSecret,
  sealedKeyId,
} from "../src/crypto.js";

const key = randomBytes(32);

function flipChar(value: string, index: number): string {
  const c = value.charAt(index);
  return value.slice(0, index) + (c === "A" ? "B" : "A") + value.slice(index + 1);
}

function legacyV1(plaintext: string, k: Buffer, context = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

describe("key rotation support", () => {
  const oldKey = randomBytes(32);

  it("records the key id and never the key", () => {
    const payload = encryptSecret("x", key);
    expect(sealedKeyId(payload)).toBe(keyId(key));
    expect(keyId(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(payload).not.toContain(key.toString("base64url"));
  });

  it("opens a value with the key list, whichever order", () => {
    const payload = encryptSecret("secret", oldKey, "ctx");
    expect(decryptSecret(payload, [key, oldKey], "ctx")).toBe("secret");
    expect(() => decryptSecret(payload, [key], "ctx")).toThrow(SecretDecryptionError);
  });

  it("still opens legacy v1 values, trying each key", () => {
    const payload = legacyV1("old-secret", oldKey, "ctx");
    expect(sealedKeyId(payload)).toBeNull();
    expect(decryptSecret(payload, [key, oldKey], "ctx")).toBe("old-secret");
    expect(() => decryptSecret(payload, key, "ctx")).toThrow(SecretDecryptionError);
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips unicode secrets", () => {
    const secret = "sk-live-مفتاح-🔑";
    expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("does not contain the plaintext", () => {
    expect(encryptSecret("sk-plaintext-value", key)).not.toContain("sk-plaintext-value");
  });

  it("detects a tampered ciphertext, tag, or IV", () => {
    const payload = encryptSecret("api-key-123456", key);
    const [version, kid, iv = "", tag = "", data = ""] = payload.split(".");
    const tampered = [
      [version, kid, iv, tag, flipChar(data, 0)],
      [version, kid, iv, flipChar(tag, 0), data],
      [version, kid, flipChar(iv, 0), tag, data],
    ];
    for (const parts of tampered) {
      expect(() => decryptSecret(parts.join("."), key)).toThrow(SecretDecryptionError);
    }
  });

  it("rejects the wrong key", () => {
    const payload = encryptSecret("api-key", key);
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow(SecretDecryptionError);
  });

  it("binds the context as AAD", () => {
    const payload = encryptSecret("api-key", key, "ai_provider:gemini");
    expect(decryptSecret(payload, key, "ai_provider:gemini")).toBe("api-key");
    expect(() => decryptSecret(payload, key, "ai_provider:openrouter")).toThrow(
      SecretDecryptionError,
    );
  });

  it("rejects malformed payloads and bad key sizes", () => {
    expect(() => decryptSecret("not-a-payload", key)).toThrow(SecretDecryptionError);
    expect(() => decryptSecret("v2.a.b.c", key)).toThrow(SecretDecryptionError);
    expect(() => encryptSecret("x", randomBytes(16))).toThrow(RangeError);
  });
});

describe("maskSecret", () => {
  it("shows at most the last 4 characters", () => {
    expect(maskSecret("sk-abcdefghijkl9f2a")).toBe("sk-…9f2a");
    expect(maskSecret("short")).toBe("••••");
  });
});
