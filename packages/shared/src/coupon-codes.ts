import { randomInt } from "node:crypto";

import { COUPON_CODE_PATTERN } from "./billing.js";

export const COUPON_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateCouponCode(
  length: number,
  prefix?: string,
  rand: (maxExclusive: number) => number = randomInt,
): string {
  const random = Array.from({ length }, () => COUPON_ALPHABET[rand(COUPON_ALPHABET.length)]).join(
    "",
  );
  const code = prefix ? `${prefix}-${random}` : random;
  if (!COUPON_CODE_PATTERN.test(code)) throw new RangeError("Generated coupon code is invalid");
  return code;
}

export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}
