import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../src/wa-agent/canonical-json.js";
import { uuidFromKey } from "../src/wa-agent/uuid-from-key.js";

const V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("canonicalJson", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [3, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[3,{"y":2,"z":1}]},"b":1}',
    );
  });

  it("keeps array positions and turns an undefined slot into null", () => {
    expect(canonicalJson([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("is the same text whatever the key order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (record) => {
        const reversed = Object.fromEntries(Object.entries(record).reverse());
        expect(canonicalJson(reversed)).toBe(canonicalJson(record));
      }),
    );
  });

  it("parses back to the same value", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });
});

describe("uuidFromKey", () => {
  const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("is deterministic and a version 8 variant 10 UUID", () => {
    const id = uuidFromKey(key);
    expect(id).toBe(uuidFromKey(key));
    expect(id).toMatch(V8);
  });

  it("always sets the version and variant bits, for any key", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]{64}$/), (hex) => {
        expect(uuidFromKey(hex)).toMatch(V8);
      }),
    );
  });

  it("differs when the first 16 bytes differ", () => {
    expect(uuidFromKey(key)).not.toBe(uuidFromKey(`f${key.slice(1)}`));
  });

  it("refuses a key that is not hex", () => {
    expect(() => uuidFromKey("nope")).toThrow();
  });
});
