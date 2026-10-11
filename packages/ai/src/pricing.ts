import type { ModelPricing, Usage } from "./types.js";

/* Money is integers only. Token prices are USD micros per 1M tokens, costs are USD micros; BigInt
 * keeps the intermediate products exact (tokens x price overflows 2^53 long before real traffic). */

const MILLION = 1_000_000n;
const MAX_EXPONENT = 60;

function toSafeInt(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("amount out of range");
  return Number(value);
}

function toCount(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer`);
  return BigInt(value);
}

/** value x 10^scale of an exact decimal string, rounded half up. No floats, no parseFloat. */
function decimalToScaled(input: string, scale: number): number {
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match) throw new RangeError("malformed decimal");
  const [, intPart = "", fracPart = "", expPart = "0"] = match;
  const exponent = Number(expPart);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_EXPONENT) {
    throw new RangeError("exponent out of range");
  }
  const digits = BigInt(intPart + fracPart);
  const shift = exponent - fracPart.length + scale;
  if (shift >= 0) return toSafeInt(digits * 10n ** BigInt(shift));
  const divisor = 10n ** BigInt(-shift);
  const quotient = digits / divisor;
  const remainder = digits % divisor;
  return toSafeInt(remainder * 2n >= divisor ? quotient + 1n : quotient);
}

/** "0.01" (USD) -> 10000 (USD micros). */
export function usdToMicros(s: string): number {
  return decimalToScaled(s, 6);
}

/** OpenRouter's USD-per-token string -> USD micros per 1M tokens: "0.00000075" -> 750000. */
export function usdPerTokenToMicrosPerM(s: string): number {
  return decimalToScaled(s, 12);
}

/**
 * USD micros for one call: uncached input, cached input (at the input price when the model has no
 * cached price), output plus thinking, and search calls. A `providerCostUsdMicros` on the usage is
 * deliberately ignored; the caller decides which figure wins.
 */
export function costUsdMicros(usage: Usage, p: ModelPricing): number {
  const input = toCount(usage.inputTokens, "inputTokens");
  // A provider reporting more cached than total would otherwise produce a negative bill.
  const cached = (() => {
    const c = toCount(usage.cachedInputTokens, "cachedInputTokens");
    return c > input ? input : c;
  })();
  const output =
    toCount(usage.outputTokens, "outputTokens") + toCount(usage.thinkingTokens, "thinkingTokens");
  const searches = toCount(usage.searchCount, "searchCount");

  const inPrice = BigInt(p.inputUsdMicrosPerM);
  const cachedPrice = BigInt(p.cachedInputUsdMicrosPerM ?? p.inputUsdMicrosPerM);
  const outPrice = BigInt(p.outputUsdMicrosPerM);

  const tokenCost = (input - cached) * inPrice + cached * cachedPrice + output * outPrice;
  const ceilCost = (tokenCost + MILLION - 1n) / MILLION;
  return toSafeInt(ceilCost + searches * BigInt(p.searchUsdMicros ?? 0));
}

/** max(1, ceil(cost x multiplier / credit value)); the multiplier is in basis points (10000 = 1x). */
export function creditsFor(
  costMicros: number,
  multiplierBp: number,
  creditValueUsdMicros: number,
): number {
  if (!Number.isSafeInteger(creditValueUsdMicros) || creditValueUsdMicros <= 0) {
    throw new RangeError("creditValueUsdMicros must be a positive integer");
  }
  const numerator = toCount(costMicros, "costMicros") * toCount(multiplierBp, "multiplierBp");
  const denominator = 10_000n * BigInt(creditValueUsdMicros);
  const credits = toSafeInt((numerator + denominator - 1n) / denominator);
  return Math.max(1, credits);
}
