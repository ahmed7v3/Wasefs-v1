// Money is always an integer count of minor units (piasters, halalas, cents). Never floats.

const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  EGP: 2,
  SAR: 2,
  AED: 2,
  USD: 2,
  EUR: 2,
  QAR: 2,
  JOD: 3,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JPY: 0,
};

/**
 * Decimal places for a currency. Known currencies use the table above; any other valid
 * ISO 4217 code (admins can add currencies) falls back to the runtime's CLDR data.
 */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  const known = CURRENCY_EXPONENT[code];
  if (known !== undefined) {
    return known;
  }
  if (!/^[A-Z]{3}$/.test(code) || !Intl.supportedValuesOf("currency").includes(code)) {
    throw new RangeError(`Unsupported currency: ${currency}`);
  }
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: code,
  }).resolvedOptions().maximumFractionDigits;
  return digits ?? 2;
}

/**
 * Decimal amount -> minor units. Strings are parsed digit by digit (no float math), and an
 * amount with more decimals than the currency allows is rejected instead of silently rounded.
 */
export function toMinor(amount: string | number, currency: string): number {
  const exponent = currencyExponent(currency);
  const text = typeof amount === "number" ? String(amount) : amount.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new RangeError("Invalid amount");
  }
  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length > exponent) {
    throw new RangeError(`Amount has more than ${exponent} decimal places`);
  }
  const minor = Number(whole + fraction.padEnd(exponent, "0"));
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError("Amount is too large");
  }
  return sign === "-" && minor !== 0 ? -minor : minor;
}

/** Minor units -> exact decimal string, e.g. `12550` EGP -> `"125.50"`. */
export function fromMinor(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError("amountMinor must be a safe integer");
  }
  const exponent = currencyExponent(currency);
  const sign = amountMinor < 0 ? "-" : "";
  const digits = String(Math.abs(amountMinor)).padStart(exponent + 1, "0");
  if (exponent === 0) {
    return `${sign}${digits}`;
  }
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export interface FormatMoneyOptions {
  /** Western digits (0-9) by default, matching the admin-configurable site default. */
  latinDigits?: boolean;
}

export function formatMoney(
  amountMinor: number,
  currency: string,
  locale = "ar",
  options: FormatMoneyOptions = {},
): string {
  const { latinDigits = true } = options;
  const resolvedLocale = latinDigits && !locale.includes("-u-") ? `${locale}-u-nu-latn` : locale;
  // The exact decimal string avoids float rounding; Intl accepts strings since ES2023.
  return new Intl.NumberFormat(resolvedLocale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(fromMinor(amountMinor, currency) as unknown as number);
}
