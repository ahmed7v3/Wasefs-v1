import { describe, expect, it } from "vitest";

import { costUsdMicros, creditsFor, usdPerTokenToMicrosPerM, usdToMicros } from "../src/index.js";

import type { ModelPricing, Usage } from "../src/index.js";

// Gemini 3.8 Flash reference: $0.75 in, $0.075 cached, $3.75 out per 1M tokens.
const FLASH: ModelPricing = {
  inputUsdMicrosPerM: 750_000,
  cachedInputUsdMicrosPerM: 75_000,
  outputUsdMicrosPerM: 3_750_000,
  searchUsdMicros: 35_000,
};

function usage(overrides: Partial<Usage>): Usage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    searchCount: 0,
    ...overrides,
  };
}

describe("usdPerTokenToMicrosPerM", () => {
  it.each([
    ["0.00000075", 750_000],
    ["0.0000375", 37_500_000],
    ["0.000000075", 75_000],
    ["0", 0],
    ["0.000001", 1_000_000],
    ["7.5e-7", 750_000],
    // Half up at the last micro: 0.0000000000005 x 1e12 = 0.5 -> 1.
    ["0.0000000000005", 1],
    ["0.0000000000004", 0],
  ])("%s -> %i", (input, expected) => {
    expect(usdPerTokenToMicrosPerM(input)).toBe(expected);
  });

  it.each(["", "-1", "-0.5", "abc", "1.2.3", " 1", "1e999", "NaN", ".5"])("rejects %j", (input) => {
    expect(() => usdPerTokenToMicrosPerM(input)).toThrow(RangeError);
  });
});

describe("usdToMicros", () => {
  it.each([
    ["0.01", 10_000],
    ["1", 1_000_000],
    ["0.0000005", 1],
    ["0.0000004", 0],
    ["12.345678", 12_345_678],
  ])("%s -> %i", (input, expected) => {
    expect(usdToMicros(input)).toBe(expected);
  });

  it("rejects malformed and negative input", () => {
    expect(() => usdToMicros("-0.01")).toThrow(RangeError);
    expect(() => usdToMicros("")).toThrow(RangeError);
  });
});

describe("costUsdMicros", () => {
  it("prices 1120 input + 500 output + 300 thinking exactly", () => {
    // (1120 x 750000 + 800 x 3750000) / 1e6 = 840 + 3000
    expect(
      costUsdMicros(usage({ inputTokens: 1120, outputTokens: 500, thinkingTokens: 300 }), FLASH),
    ).toBe(3840);
  });

  it("charges cached input at the cached price", () => {
    // (920 x 750000 + 200 x 75000 + 800 x 3750000) / 1e6 = 690 + 15 + 3000
    expect(
      costUsdMicros(
        usage({
          inputTokens: 1120,
          cachedInputTokens: 200,
          outputTokens: 500,
          thinkingTokens: 300,
        }),
        FLASH,
      ),
    ).toBe(3705);
  });

  it("falls back to the input price when the model has no cached price", () => {
    const pricing = { ...FLASH, cachedInputUsdMicrosPerM: null };
    expect(costUsdMicros(usage({ inputTokens: 1000, cachedInputTokens: 400 }), pricing)).toBe(750);
  });

  it("rounds up to the next micro", () => {
    expect(costUsdMicros(usage({ inputTokens: 1 }), FLASH)).toBe(1);
  });

  it("adds search calls after rounding", () => {
    expect(costUsdMicros(usage({ inputTokens: 1000, searchCount: 2 }), FLASH)).toBe(750 + 70_000);
    expect(costUsdMicros(usage({ searchCount: 3 }), { ...FLASH, searchUsdMicros: null })).toBe(0);
  });

  it("ignores providerCostUsdMicros", () => {
    expect(costUsdMicros(usage({ inputTokens: 1000, providerCostUsdMicros: 999_999 }), FLASH)).toBe(
      750,
    );
  });

  it("never goes negative when cached exceeds input", () => {
    // Cached is clamped to input: 100 x 75000 / 1e6 = 7.5 -> 8.
    expect(costUsdMicros(usage({ inputTokens: 100, cachedInputTokens: 500 }), FLASH)).toBe(8);
  });

  it("stays exact beyond 2^53 intermediate products", () => {
    const huge = costUsdMicros(usage({ inputTokens: 2_000_000_000 }), {
      ...FLASH,
      inputUsdMicrosPerM: 999_999_999_999,
    });
    expect(huge).toBe(1_999_999_999_998_000);
  });

  it("rejects non-integer or negative counts", () => {
    expect(() => costUsdMicros(usage({ inputTokens: 1.5 }), FLASH)).toThrow(RangeError);
    expect(() => costUsdMicros(usage({ outputTokens: -1 }), FLASH)).toThrow(RangeError);
  });
});

describe("creditsFor", () => {
  it.each([
    [4500, 10_000, 10_000, 1],
    [25_001, 15_000, 10_000, 4],
    [0, 10_000, 10_000, 1],
    [100_000, 10_000, 10_000, 10],
    [100_001, 10_000, 10_000, 11],
  ])("creditsFor(%i, %i, %i) = %i", (cost, bp, value, expected) => {
    expect(creditsFor(cost, bp, value)).toBe(expected);
  });

  it("rejects a non-positive credit value", () => {
    expect(() => creditsFor(1, 10_000, 0)).toThrow(RangeError);
  });
});
