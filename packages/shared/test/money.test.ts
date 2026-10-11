import { describe, expect, it } from "vitest";

import { formatMoney, fromMinor, microsToUsd, toMinor, usdToMicros } from "../src/money.js";

describe("toMinor", () => {
  it("converts decimal strings without float error", () => {
    expect(toMinor("1.005", "KWD")).toBe(1005);
    expect(toMinor("0.1", "EGP")).toBe(10);
    expect(toMinor("19.99", "USD")).toBe(1999);
    expect(toMinor(125.5, "EGP")).toBe(12550);
    expect(toMinor("100", "JPY")).toBe(100);
  });

  it("handles negatives and zero", () => {
    expect(toMinor("-5.25", "SAR")).toBe(-525);
    expect(toMinor("-0.00", "SAR")).toBe(0);
  });

  it("rejects too many decimals, bad input and unknown currency", () => {
    expect(() => toMinor("1.005", "EGP")).toThrow(RangeError);
    expect(() => toMinor("abc", "EGP")).toThrow(RangeError);
    expect(() => toMinor("1e3", "EGP")).toThrow(RangeError);
    expect(() => toMinor("1", "QQQ")).toThrow(RangeError);
    expect(() => toMinor("99999999999999999", "EGP")).toThrow(RangeError);
  });
});

describe("fromMinor", () => {
  it("formats exact decimal strings", () => {
    expect(fromMinor(12550, "EGP")).toBe("125.50");
    expect(fromMinor(5, "EGP")).toBe("0.05");
    expect(fromMinor(-525, "SAR")).toBe("-5.25");
    expect(fromMinor(1005, "KWD")).toBe("1.005");
    expect(fromMinor(100, "JPY")).toBe("100");
  });

  it("round-trips with toMinor", () => {
    for (const minor of [0, 1, 99, 100, 123456789]) {
      expect(toMinor(fromMinor(minor, "EGP"), "EGP")).toBe(minor);
    }
  });

  it("rejects non-integers", () => {
    expect(() => fromMinor(1.5, "EGP")).toThrow(RangeError);
    expect(() => fromMinor(Number.NaN, "EGP")).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  it("uses Western digits by default in Arabic", () => {
    const out = formatMoney(12550, "EGP", "ar");
    expect(out).toMatch(/125\.50/);
    expect(out).not.toMatch(/[٠-٩]/);
  });

  it("can render Arabic-Indic digits when asked", () => {
    expect(formatMoney(12550, "EGP", "ar-EG", { latinDigits: false })).toMatch(/[٠-٩]/);
    expect(formatMoney(12550, "EGP", "ar-EG")).not.toMatch(/[٠-٩]/);
  });

  it("formats English", () => {
    expect(formatMoney(1999, "USD", "en-US")).toBe("$19.99");
  });
});

describe("currencyExponent fallback", () => {
  it("uses CLDR data for valid ISO codes outside the built-in table", async () => {
    const { currencyExponent } = await import("../src/money.js");
    expect(currencyExponent("TND")).toBe(3);
    expect(currencyExponent("mad")).toBe(2);
    expect(() => currencyExponent("QQQ")).toThrow(RangeError);
    expect(() => currencyExponent("EGPX")).toThrow(RangeError);
  });
});

describe("usdToMicros / microsToUsd", () => {
  it.each([
    ["0.75", 750_000],
    ["3.75", 3_750_000],
    ["12", 12_000_000],
    ["0.000125", 125],
    [" 0.1 ", 100_000],
  ])("parses %s exactly", (input, micros) => {
    expect(usdToMicros(input)).toBe(micros);
    expect(usdToMicros(microsToUsd(micros))).toBe(micros);
  });

  it.each(["", "-1", "1.0000001", "1e3", "abc", "1,5"])("rejects %j", (input) => {
    expect(usdToMicros(input)).toBeNull();
  });

  it("formats the shortest exact string", () => {
    expect(microsToUsd(750_000)).toBe("0.75");
    expect(microsToUsd(10_000)).toBe("0.01");
    expect(microsToUsd(0)).toBe("0");
    expect(() => microsToUsd(-1)).toThrow(RangeError);
  });
});
