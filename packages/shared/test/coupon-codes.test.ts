import { describe, expect, it } from "vitest";

import { COUPON_CODE_PATTERN } from "../src/billing.js";
import { COUPON_ALPHABET, generateCouponCode, normalizeCouponCode } from "../src/coupon-codes.js";

describe("coupon codes", () => {
  it("excludes look-alike characters", () => {
    expect(COUPON_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it("generates valid codes with the requested length and prefix", () => {
    for (let index = 0; index < 10_000; index++) {
      const code = generateCouponCode(8, "WASFA");
      expect(code).toMatch(COUPON_CODE_PATTERN);
      expect(code).toHaveLength(14);
      expect(code.startsWith("WASFA-")).toBe(true);
    }
  });

  it("supports deterministic randomness and normalization", () => {
    expect(generateCouponCode(6, undefined, () => 0)).toBe("AAAAAA");
    expect(normalizeCouponCode("  wasfa-10 ")).toBe("WASFA-10");
  });
});
