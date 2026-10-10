import { describe, expect, it } from "vitest";

import { isErrorRef, newErrorRef, newId } from "../src/ids.js";

describe("newId", () => {
  it("returns a UUIDv7", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("encodes the timestamp in the first 48 bits", () => {
    const now = 1_760_000_000_123;
    const hex = newId(now).replace(/-/g, "").slice(0, 12);
    expect(parseInt(hex, 16)).toBe(now);
  });

  it("sorts by creation time and is unique", () => {
    const earlier = newId(1_760_000_000_000);
    const later = newId(1_760_000_000_001);
    expect(earlier < later).toBe(true);
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
  });
});

describe("newErrorRef", () => {
  it("matches WSF-XXXX-XXXX without ambiguous characters", () => {
    for (let i = 0; i < 500; i++) {
      const ref = newErrorRef();
      expect(ref).toMatch(/^WSF-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(isErrorRef(ref)).toBe(true);
      expect(ref.slice(4)).not.toMatch(/[ILOU]/);
    }
  });

  it("rejects malformed refs", () => {
    expect(isErrorRef("WSF-ABCD-EFGO")).toBe(false);
    expect(isErrorRef("wsf-abcd-efgh")).toBe(false);
    expect(isErrorRef(undefined)).toBe(false);
  });
});
