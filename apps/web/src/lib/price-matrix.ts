import { fromMinor, toMinor } from "@wasfa/shared/money";

/*
 * The plan price matrix (months x currencies) as a client draft. Cells hold the text the admin
 * typed in major units ("99.50"); they become integer minor units only here, with the shared money
 * helpers (no floats). An empty cell means "not offered in that currency". Nothing is published
 * from here: the API prices and validates on Publish.
 */

export const MATRIX_MONTHS = [1, 3, 6, 12] as const;
export const DEFAULT_CURRENCIES = ["EGP", "USD"] as const;

export interface PriceCell {
  months: number;
  currency: string;
  amountMinor: number | null;
}

export type MatrixDraft = Readonly<Record<string, string>>;

export const cellKey = (months: number, currency: string): string =>
  `${String(months)}:${currency}`;

/** Draft text of every stored price (`null` = stored but switched off = empty cell). */
export function matrixFromPrices(prices: readonly PriceCell[]): MatrixDraft {
  const draft: Record<string, string> = {};
  for (const price of prices) {
    draft[cellKey(price.months, price.currency)] =
      price.amountMinor === null ? "" : fromMinor(price.amountMinor, price.currency);
  }
  return draft;
}

/** The currencies to show as columns: the stored ones first, then the defaults. */
export function matrixCurrencies(
  prices: readonly PriceCell[],
  extra: readonly string[] = [],
): string[] {
  return [...new Set([...prices.map((price) => price.currency), ...DEFAULT_CURRENCIES, ...extra])];
}

/** The rows to show: the standard periods, any other period that already has a price, and added ones. */
export function matrixMonths(prices: readonly PriceCell[], extra: readonly number[] = []): number[] {
  return [...new Set([...MATRIX_MONTHS, ...prices.map((price) => price.months), ...extra])].sort(
    (left, right) => left - right,
  );
}

export interface MatrixResult {
  /** What to send: every stored price (emptied ones as `null`) plus each newly filled cell. */
  prices: PriceCell[];
  /** Cell key to the reason: `invalid`, for cells that are not a valid amount in that currency. */
  errors: Record<string, "invalid">;
}

export function pricesFromMatrix(draft: MatrixDraft, stored: readonly PriceCell[]): MatrixResult {
  const prices: PriceCell[] = [];
  const errors: Record<string, "invalid"> = {};
  const seen = new Set<string>();

  const read = (months: number, currency: string): number | null | "invalid" => {
    const text = (draft[cellKey(months, currency)] ?? "").trim();
    if (text === "") return null;
    try {
      const minor = toMinor(text, currency);
      return minor < 0 ? "invalid" : minor;
    } catch {
      return "invalid";
    }
  };

  const visit = (months: number, currency: string, existed: boolean) => {
    const key = cellKey(months, currency);
    if (seen.has(key)) return;
    seen.add(key);
    const value = read(months, currency);
    if (value === "invalid") {
      errors[key] = "invalid";
      return;
    }
    // A cell that never had a price and is still empty stays out of the request.
    if (value === null && !existed) return;
    prices.push({ months, currency, amountMinor: value });
  };

  for (const price of stored) visit(price.months, price.currency, true);
  for (const key of Object.keys(draft)) {
    const [monthsText = "", currency = ""] = key.split(":");
    visit(Number(monthsText), currency, false);
  }
  return { prices, errors };
}

/** "Fill the 12-month price from monthly x 10"; leaves the draft alone when the monthly cell is not an amount. */
export function fillYearFromMonthly(draft: MatrixDraft, currency: string): MatrixDraft {
  const text = (draft[cellKey(1, currency)] ?? "").trim();
  if (text === "") return draft;
  try {
    const yearly = toMinor(text, currency) * 10;
    return { ...draft, [cellKey(12, currency)]: fromMinor(yearly, currency) };
  } catch {
    return draft;
  }
}
