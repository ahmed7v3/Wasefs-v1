import { describe, expect, it } from "vitest";

import { signPreviewToken, verifyPreviewToken } from "../../src/content/preview-token.js";

const SECRET = "x".repeat(40);
const ITEM = "0192f6a0-0000-7000-8000-000000000001";
const REVISION = "0192f6a0-0000-7000-8000-000000000002";
const NOW = new Date("2026-10-24T12:00:00Z");
const inOneHour = Math.floor(NOW.getTime() / 1000) + 3600;

describe("preview token", () => {
  it("round-trips the item, the revision and the expiry", () => {
    const token = signPreviewToken(SECRET, {
      itemId: ITEM,
      revisionId: REVISION,
      expiresAt: inOneHour,
    });
    expect(verifyPreviewToken(SECRET, token, NOW)).toEqual({
      itemId: ITEM,
      revisionId: REVISION,
      expiresAt: inOneHour,
    });
  });

  it("works without a revision id", () => {
    const token = signPreviewToken(SECRET, { itemId: ITEM, expiresAt: inOneHour });
    expect(verifyPreviewToken(SECRET, token, NOW)?.revisionId).toBeUndefined();
  });

  it("refuses an expired token", () => {
    const token = signPreviewToken(SECRET, { itemId: ITEM, expiresAt: inOneHour });
    expect(verifyPreviewToken(SECRET, token, new Date(NOW.getTime() + 3600_000))).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = signPreviewToken("y".repeat(40), { itemId: ITEM, expiresAt: inOneHour });
    expect(verifyPreviewToken(SECRET, token, NOW)).toBeNull();
  });

  it("refuses a tampered body or signature", () => {
    const token = signPreviewToken(SECRET, { itemId: ITEM, expiresAt: inOneHour });
    const [body, signature] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ i: REVISION, e: inOneHour + 99_999 })).toString(
      "base64url",
    );
    expect(verifyPreviewToken(SECRET, `${forged}.${signature}`, NOW)).toBeNull();
    expect(verifyPreviewToken(SECRET, `${body}.${signature.slice(1)}A`, NOW)).toBeNull();
  });

  it.each(["", "abc", "a.b.c", "x".repeat(700), ".", "a."])("refuses malformed input %#", (raw) => {
    expect(verifyPreviewToken(SECRET, raw, NOW)).toBeNull();
  });

  it("refuses a validly signed payload with a non-uuid id", () => {
    const token = signPreviewToken(SECRET, { itemId: "not-a-uuid", expiresAt: inOneHour });
    expect(verifyPreviewToken(SECRET, token, NOW)).toBeNull();
  });
});
