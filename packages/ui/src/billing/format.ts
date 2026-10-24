import { hasMessage, t, type MessageKey } from "@wasfa/shared/i18n/public";
import { formatMoney } from "@wasfa/shared/money";

import type { Locale } from "@wasfa/shared/i18n";

/*
 * Small formatting helpers shared by the billing components and the pages that use them. Money is
 * always an integer count of minor units; the amount is only ever displayed here, never computed.
 */

/** `283.10 ج.م.`: Western digits, the currency's own symbol. */
export function moneyText(amountMinor: number, currency: string, locale: Locale = "ar"): string {
  return formatMoney(amountMinor, currency, locale);
}

/** "شهر واحد", "3 أشهر", "سنة كاملة", "18 شهرًا": the length of a purchased period. */
export function periodLabel(months: number, locale: Locale = "ar"): string {
  if (months === 1) return t("billing.period.one", undefined, locale);
  if (months === 12) return t("billing.period.year", undefined, locale);
  if (months >= 3 && months <= 10) return t("billing.period.few", { count: months }, locale);
  return t("billing.period.many", { count: months }, locale);
}

function isMessageKey(key: string): key is MessageKey {
  return hasMessage(key);
}

/**
 * The text of a quote line (`billing.line.*` from the price engine). A key this build does not
 * know falls back to a neutral label instead of showing a raw key.
 */
export function lineLabel(labelKey: string, locale: Locale = "ar"): string {
  return isMessageKey(labelKey)
    ? t(labelKey, undefined, locale)
    : t("billing.line.other", undefined, locale);
}
