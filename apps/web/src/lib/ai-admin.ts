import { t } from "@wasfa/shared/i18n";
import { microsToUsd, usdToMicros } from "@wasfa/shared/money";

/*
 * Money and multiplier text of the admin AI pages (providers, models, settings). Admins type USD
 * ("0.75"); the API takes integer micros and basis points. All conversions are string math, never
 * floats, and each one is the inverse of the other.
 */

/** Same ceiling as the API's price fields (`PRICE_MAX` in the admin-ai schema). */
export const PRICE_MAX_MICROS = 1_000_000_000_000;

export type MoneyParse =
  { ok: true; value: number | null } | { ok: false; reason: "required" | "invalid" };

/**
 * A typed USD amount as integer micros. A blank field is `null` when optional, "required" otherwise;
 * anything that is not a plain decimal with at most 6 fraction digits (or is above the API ceiling)
 * is "invalid".
 */
export function parseUsd(input: string, optional: boolean): MoneyParse {
  if (input.trim() === "")
    return optional ? { ok: true, value: null } : { ok: false, reason: "required" };
  const micros = usdToMicros(input);
  if (micros === null || micros > PRICE_MAX_MICROS) return { ok: false, reason: "invalid" };
  return { ok: true, value: micros };
}

/** Micros as the text of an input ("0.75"). */
export function usdInputText(micros: number | null): string {
  return micros === null ? "" : microsToUsd(micros);
}

/** `$0.75`, `$3.75`, `$1.00`: at least two decimals, more only when the price needs them. */
export function formatUsd(micros: number): string {
  const text = microsToUsd(micros);
  const [whole = "0", fraction = ""] = text.split(".");
  return `$${whole}.${fraction.padEnd(2, "0")}`;
}

const MULTIPLIER_INPUT = /^(\d{1,3})(?:\.(\d{1,4}))?$/;
const MULTIPLIER_MAX_BP = 1_000_000;

/** "1.5" -> 15000 basis points; null when it is not a decimal with at most 4 fraction digits in 0.0001..100. */
export function multiplierToBp(input: string): number | null {
  const match = MULTIPLIER_INPUT.exec(input.trim());
  if (!match) return null;
  const [, whole = "0", fraction = ""] = match;
  const bp = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
  return bp >= 1 && bp <= MULTIPLIER_MAX_BP ? bp : null;
}

/** 15000 -> "1.5", 10000 -> "1": the text of the multiplier input. */
export function bpToMultiplierText(bp: number): string {
  const whole = Math.floor(bp / 10_000);
  const fraction = String(bp % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** "×1.50": at least two decimals, as shown in tables and next to the multiplier input. */
export function formatMultiplier(bp: number): string {
  const [whole = "0", fraction = ""] = bpToMultiplierText(bp).split(".");
  return t("admin.ai.multiplier", { value: `${whole}.${fraction.padEnd(2, "0")}` });
}
