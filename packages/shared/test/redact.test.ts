import { describe, expect, it } from "vitest";

import { LOG_REDACT_PATHS, redactText } from "../src/redact.js";

describe("redactText", () => {
  it("removes emails, phones, bearer tokens and connection-string passwords", () => {
    const text =
      "user ahmed@example.com phone +20 100 123 4567 auth Bearer abc.def.ghi db postgres://u:secret@h/db";
    const out = redactText(text);
    expect(out).not.toMatch(/ahmed@example\.com|123 4567|abc\.def\.ghi|secret/);
    expect(out).toContain("[EMAIL]");
    expect(out).toContain("[PHONE]");
  });
});

describe("LOG_REDACT_PATHS", () => {
  it("covers the headers and fields AGENT.md §5.7 requires", () => {
    expect(LOG_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.phone",
        "*.email",
        "*.apiKey",
      ]),
    );
  });
});
