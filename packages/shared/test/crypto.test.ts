import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SecretDecryptionError,
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "../src/crypto.js";

const key = randomBytes(32);

function flipChar(value: string, index: number): string {
  const c = value.charAt(index);
  return value.slice(0, index) + (c === "A" ? "B" : "A") + value.slice(index + 1);
}

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
    const [version, iv = "", tag = "", data = ""] = payload.split(".");
    const tampered = [
      [version, iv, tag, flipChar(data, 0)],
      [version, iv, flipChar(tag, 0), data],
      [version, flipChar(iv, 0), tag, data],
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
