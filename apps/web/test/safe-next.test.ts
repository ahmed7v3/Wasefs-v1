import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT, safeNext } from "../src/lib/safe-next";

describe("safeNext", () => {
  it("keeps same-origin relative paths, with query and hash", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/account/security?tab=2fa#top")).toBe("/account/security?tab=2fa#top");
    expect(safeNext("/")).toBe("/");
  });

  it("falls back when missing or not a string", () => {
    expect(safeNext(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNext(null)).toBe(DEFAULT_NEXT);
    expect(safeNext("")).toBe(DEFAULT_NEXT);
    expect(safeNext([])).toBe(DEFAULT_NEXT);
  });

  it("uses the first value when the parameter is repeated", () => {
    expect(safeNext(["/account", "/other"])).toBe("/account");
    expect(safeNext(["//evil.example", "/account"])).toBe(DEFAULT_NEXT);
  });

  it.each([
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "http://evil.example/dashboard",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "evil.example",
    "dashboard",
    "/ /evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\u0000/evil.example",
  ])("rejects %j", (value) => {
    expect(safeNext(value)).toBe(DEFAULT_NEXT);
  });

  it.each([
    "/%2F%2Fevil.example",
    "/%2f%2fevil.example",
    "/%5Cevil.example",
    "/%5cevil.example",
    "/%09/evil.example",
    "/%0a/evil.example",
    "/%0D/evil.example",
    "/%E0%A4%A",
  ])("rejects the encoded variant %j", (value) => {
    expect(safeNext(value)).toBe(DEFAULT_NEXT);
  });

  it("rejects an overlong value", () => {
    expect(safeNext(`/${"a".repeat(3_000)}`)).toBe(DEFAULT_NEXT);
  });
});
