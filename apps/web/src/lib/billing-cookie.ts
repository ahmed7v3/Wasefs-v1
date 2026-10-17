/** The remembered currency choice (not a secret, not personal data): read back by the pricing page. */
export const CURRENCY_COOKIE = "currency";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Browser only: remembers the currency the visitor picked for a year. */
export function rememberCurrency(code: string): void {
  document.cookie = `${CURRENCY_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=${String(ONE_YEAR_SECONDS)}; samesite=lax`;
}
