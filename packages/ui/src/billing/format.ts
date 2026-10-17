import { ar, t, type MessageKey } from "@wasfa/shared/i18n";
import { formatMoney } from "@wasfa/shared/money";

/*
 * Small formatting helpers shared by the billing components and the pages that use them. Money is
 * always an integer count of minor units; the amount is only ever displayed here, never computed.
 */

/** `283.10 ج.م.`: Western digits, the currency's own symbol. */
export function moneyText(amountMinor: number, currency: string): string {
  return formatMoney(amountMinor, currency, "ar");
}

/** "شهر واحد", "3 أشهر", "سنة كاملة", "18 شهرًا": the length of a purchased period. */
export function periodLabel(months: number): string {
  if (months === 1) return t("billing.period.one");
  if (months === 12) return t("billing.period.year");
  if (months >= 3 && months <= 10) return t("billing.period.few", { count: months });
  return t("billing.period.many", { count: months });
}

function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(ar, key);
}

/**
 * The text of a quote line (`billing.line.*` from the price engine). A key this build does not
 * know falls back to a neutral label instead of showing a raw key.
 */
export function lineLabel(labelKey: string): string {
  return isMessageKey(labelKey) ? t(labelKey) : t("billing.line.other");
}
