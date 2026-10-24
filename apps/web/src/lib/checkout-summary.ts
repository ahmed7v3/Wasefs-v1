import { t } from "@wasfa/shared/i18n/public";
import { lineLabel, type SummaryFeeItem, type SummaryLine } from "@wasfa/ui";

import type { QuoteResponse } from "@wasfa/shared/schemas/billing";

/*
 * The server's quote, shaped for `CheckoutSummary`. Nothing is computed here beyond picking which
 * server-quoted number goes where; the one exception is `previewForMethod`, which swaps the fee for
 * the chosen method's fee from `methodOptions` so the total moves the instant the choice changes
 * (the confirming re-quote then replaces it).
 */

type Quote = QuoteResponse["quote"];

export interface FeeModel {
  show: boolean;
  amountMinor: number;
  items: SummaryFeeItem[];
}

export interface SummaryModel {
  lines: SummaryLine[];
  perks: string[];
  fee: FeeModel;
  totalMinor: number;
  /** What the Pay button repeats. */
  buttonTotalMinor: number;
}

function feeItems(items: Quote["display"]["feeLine"]["items"]): SummaryFeeItem[] {
  return items.map((item) => ({
    key: item.kind,
    label: item.kind === "tax" ? t("billing.fee.tax") : t("billing.fee.method"),
    amountMinor: item.amountMinor,
  }));
}

/** Lines the summary lists: the item, discounts, the upgrade credit and a minimum-charge adjustment. */
function summaryLines(quote: Quote, subject: string): SummaryLine[] {
  const lines: SummaryLine[] = [];
  quote.lines.forEach((line, index) => {
    const key = `${line.kind}-${String(index)}`;
    if (line.kind === "plan") {
      lines.push({ key, label: subject, amountMinor: line.amountMinor });
    } else if (line.kind === "discount") {
      lines.push({
        key,
        label: lineLabel(line.labelKey),
        amountMinor: line.amountMinor,
        tone: "discount",
      });
    } else if (line.kind === "proration") {
      lines.push({
        key,
        label: lineLabel(line.labelKey),
        amountMinor: line.amountMinor,
        tone: "discount",
        explanation: t("billing.proration.explain"),
      });
    } else if (line.kind === "adjustment") {
      lines.push({
        key,
        label: lineLabel(line.labelKey),
        amountMinor: line.amountMinor,
        explanation: t("billing.minimumCharge.explain"),
      });
    }
  });
  return lines;
}

function perksOf(quote: Quote): string[] {
  const perks: string[] = [];
  if (quote.grants.bonusCredits > 0) {
    perks.push(t("billing.perk.bonusCredits", { count: quote.grants.bonusCredits }));
  }
  if (quote.grants.extraMonths > 0) {
    perks.push(t("billing.perk.extraMonths", { count: quote.grants.extraMonths }));
  }
  return perks;
}

/** The summary of a quote as the server priced it, for the method it was priced with. */
export function summaryFromQuote(quote: Quote, subject: string): SummaryModel {
  const { feeLine, buttonTotalMinor } = quote.display;
  return {
    lines: summaryLines(quote, subject),
    perks: perksOf(quote),
    fee: { show: feeLine.show, amountMinor: feeLine.amountMinor, items: feeItems(feeLine.items) },
    totalMinor: quote.totalMinor,
    buttonTotalMinor,
  };
}

/**
 * The same quote re-read for another method, from the server's own `methodOptions` row: the total
 * is that row's total and the fee part of the combined line is that row's fee. Null when the
 * method is not in the quote.
 */
export function previewForMethod(
  quote: Quote,
  subject: string,
  methodKey: string,
): SummaryModel | null {
  const option = quote.methodOptions.find((candidate) => candidate.key === methodKey);
  if (!option) return null;
  const base = summaryFromQuote(quote, subject);
  const taxItems = base.fee.items.filter((item) => item.key === "tax");
  const taxMinor = taxItems.reduce((sum, item) => sum + item.amountMinor, 0);
  const items: SummaryFeeItem[] = [
    ...taxItems,
    ...(option.feeMinor > 0
      ? [{ key: "fee", label: t("billing.fee.method"), amountMinor: option.feeMinor }]
      : []),
  ];
  const amountMinor = taxMinor + option.feeMinor;
  return {
    ...base,
    fee: { show: items.length > 0, amountMinor, items },
    totalMinor: option.totalMinor,
    buttonTotalMinor: option.totalMinor,
  };
}
