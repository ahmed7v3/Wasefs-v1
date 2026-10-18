import { describe, expect, it } from "vitest";

import { COUPON_CODE_PATTERN } from "../src/billing.js";
import { COUPON_ALPHABET, generateCouponCode, normalizeCouponCode } from "../src/coupon-codes.js";

describe("coupon codes", () => {
  it("excludes look-alike characters", () => {
    expect(COUPON_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it("generates valid codes with the requested length and prefix", () => {
    // One assertion over the whole sample: 30,000 separate expects took over 5 s on a CI runner.
    const codes = Array.from({ length: 10_000 }, () => generateCouponCode(8, "WASFA"));
    const invalid = codes.filter(
      (code) => !COUPON_CODE_PATTERN.test(code) || code.length !== 14 || !code.startsWith("WASFA-"),
    );
    expect(invalid).toEqual([]);
  });

  it("supports deterministic randomness and normalization", () => {
    expect(generateCouponCode(6, undefined, () => 0)).toBe("AAAAAA");
    expect(normalizeCouponCode("  wasfa-10 ")).toBe("WASFA-10");
  });
});
