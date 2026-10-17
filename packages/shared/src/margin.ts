export interface PlanMarginInput {
  amountMinor: number;
  months: number;
  currency: string;
  monthlyCredits: number;
  costPerCreditUsdMicros: number;
  fxUsdToEgp: number;
  taxMode: "added" | "inclusive" | null;
  taxRateBps: number;
  feeBps: number;
}

export interface PlanMargin {
  revenueMonthlyMinor: number;
  costFullMinor: number;
  marginFullMinor: number;
  marginBps: number;
  breakEvenBps: number;
  warn: boolean;
}

const BPS = 10_000n;
const USD_MICROS_PER_MINOR = 10_000n;

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function scaledFx(value: number): bigint {
  const [mantissa = "0", exponentText = "0"] = value.toString().toLowerCase().split("e");
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  const shift = Number(exponentText) - fraction.length + 6;
  return shift >= 0 ? digits * 10n ** BigInt(shift) : roundHalfUp(digits, 10n ** BigInt(-shift));
}

/** Integer-only margin estimate using USD micros for AI cost and minor units for prices. */
export function planMargin(input: PlanMarginInput): PlanMargin | null {
  if (input.currency !== "USD" && input.currency !== "EGP") return null;
  if (
    !Number.isInteger(input.amountMinor) ||
    !Number.isInteger(input.months) ||
    input.months < 1 ||
    !Number.isInteger(input.monthlyCredits) ||
    input.monthlyCredits < 0 ||
    !Number.isInteger(input.costPerCreditUsdMicros) ||
    input.costPerCreditUsdMicros < 0 ||
    !Number.isFinite(input.fxUsdToEgp) ||
    input.fxUsdToEgp <= 0 ||
    !Number.isInteger(input.taxRateBps) ||
    input.taxRateBps < 0 ||
    input.taxRateBps > 10_000 ||
    !Number.isInteger(input.feeBps) ||
    input.feeBps < 0 ||
    input.feeBps > 10_000
  ) {
    return null;
  }

  const amount = BigInt(input.amountMinor);
  const tax = BigInt(input.taxRateBps);
  const fee = BigInt(input.feeBps);
  let netRevenue = amount;
  if (input.taxMode === "inclusive" && tax > 0n) {
    netRevenue -= roundHalfUp(amount * tax, BPS + tax);
  }
  if (fee >= BPS) return null;
  netRevenue = roundHalfUp(netRevenue * (BPS - fee), BPS);

  const revenueMonthly = netRevenue / BigInt(input.months);
  const creditCostUsdMicros =
    BigInt(input.monthlyCredits) * BigInt(input.costPerCreditUsdMicros) * BigInt(input.months);
  const costFull =
    input.currency === "USD"
      ? roundHalfUp(creditCostUsdMicros, USD_MICROS_PER_MINOR)
      : roundHalfUp(creditCostUsdMicros * scaledFx(input.fxUsdToEgp), 10n ** 10n);
  const marginFull = netRevenue - costFull;
  const marginBps = netRevenue > 0n ? (marginFull * BPS) / netRevenue : 0n;
  const breakEvenBps = netRevenue > 0n ? (costFull * BPS) / netRevenue : 0n;

  return {
    revenueMonthlyMinor: Number(revenueMonthly),
    costFullMinor: Number(costFull),
    marginFullMinor: Number(marginFull),
    marginBps: Number(marginBps),
    breakEvenBps: Number(breakEvenBps),
    warn: marginBps < 5_000n,
  };
}
