import type { CreditPackEntry } from "./quote-inputs.repo.js";
import type { QuoteInput } from "@wasfa/shared/price-engine";
import type { SettingValue } from "@wasfa/shared/settings";

/**
 * Credits are valued at the cheapest pack price per credit, so a "bonus credits" discount competes
 * with money discounts by what the customer would otherwise pay (conservative: never overvalued).
 * No pack in the currency = no value, and such a discount then never wins on saving.
 */
export function creditValueMinor(packs: readonly CreditPackEntry[]): number | undefined {
  const perCredit = packs
    .filter((pack) => pack.credits + pack.bonusCredits > 0)
    .map((pack) => Math.floor(pack.amountMinor / (pack.credits + pack.bonusCredits)));
  return perCredit.length > 0 ? Math.min(...perCredit) : undefined;
}

/** The `billing` setting as the price engine takes it. */
export function engineSettings(
  billing: SettingValue<"billing">,
  packs: readonly CreditPackEntry[],
): QuoteInput["settings"] {
  return {
    maxTotalDiscountBps: billing.maxTotalDiscountBps,
    minChargeMinor: billing.minChargeMinor,
    minChargeMode: billing.minChargeMode,
    allowFreeOrders: billing.allowFreeOrders,
    quoteTtlMinutes: billing.quoteTtlMinutes,
    creditValueMinor: creditValueMinor(packs),
  };
}
