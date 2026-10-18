import { t } from "@wasfa/shared/i18n";
import { Gift, Info } from "lucide-react";

import { cn } from "../cn";

import { moneyText } from "./format";

import type { ReactNode } from "react";

export interface SummaryLine {
  key: string;
  label: string;
  /** Signed: a discount or a proration credit is negative. */
  amountMinor: number;
  tone?: "plain" | "discount" | undefined;
  /** One plain-words sentence under the line (what a proration credit is). */
  explanation?: string | undefined;
}

export interface SummaryFeeItem {
  key: string;
  label: string;
  amountMinor: number;
}

export interface CheckoutSummaryProps {
  currency: string;
  /** The plan or pack line first, then discounts, proration and adjustments, in the engine order. */
  lines: readonly SummaryLine[];
  /** What the order adds on top, as ready sentences ("+30 رصيد هدية"). */
  perks?: readonly string[] | undefined;
  /**
   * The ONE combined «الضريبة والرسوم» line (BILLING §6.2) with its itemisation. Left out only when
   * `show` is false, i.e. there is neither tax nor fee to tell.
   */
  fee: { show: boolean; amountMinor: number; items: readonly SummaryFeeItem[] };
  totalMinor: number;
  /** The numbers are being confirmed by the server. */
  updating?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

const row = "flex items-baseline justify-between gap-3 text-base";

/**
 * The checkout summary (BILLING §6.2): complete on first render, one combined tax-and-fee line that
 * opens into its parts, and «الإجمالي» in the largest type. Everything shown is a number the server
 * quoted; nothing is computed here.
 */
export function CheckoutSummary({
  currency,
  lines,
  perks,
  fee,
  totalMinor,
  updating = false,
  className,
  children,
}: CheckoutSummaryProps) {
  return (
    <div
      aria-busy={updating || undefined}
      className={cn("flex flex-col gap-3", updating && "opacity-80", className)}
    >
      <ul className="flex flex-col gap-3">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-col gap-0.5">
            <div className={cn(row, line.tone === "discount" && "font-semibold text-success")}>
              <span>{line.label}</span>
              <span className="tabular-nums">
                <bdi>{moneyText(line.amountMinor, currency)}</bdi>
              </span>
            </div>
            {line.explanation ? (
              <p className="text-sm text-text-muted">{line.explanation}</p>
            ) : null}
          </li>
        ))}
        {perks?.map((perk) => (
          <li key={perk} className="flex items-center gap-2 text-base font-semibold text-success">
            <Gift aria-hidden className="size-4 shrink-0" />
            {perk}
          </li>
        ))}
        {fee.show ? (
          <li>
            <details className="group">
              <summary
                className={cn(
                  row,
                  "min-h-11 cursor-pointer list-none rounded-md focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t("billing.summary.taxAndFees")}
                  <Info aria-hidden className="size-4 text-text-muted" />
                  <span className="sr-only">{t("billing.summary.taxAndFeesHint")}</span>
                </span>
                <span className="tabular-nums" data-testid="summary-fee-amount">
                  <bdi>{moneyText(fee.amountMinor, currency)}</bdi>
                </span>
              </summary>
              <ul className="mt-1 flex flex-col gap-1.5 rounded-md bg-neutral-50 p-3 text-sm text-text-muted">
                {fee.items.map((item) => (
                  <li key={item.key} className="flex items-baseline justify-between gap-3">
                    <span>{item.label}</span>
                    <span className="tabular-nums">
                      <bdi>{moneyText(item.amountMinor, currency)}</bdi>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ) : null}
      </ul>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="flex items-baseline justify-between gap-3 border-t border-border pt-3"
      >
        <span className="font-heading text-lg font-bold text-text">
          {t("billing.summary.total")}
        </span>
        <span
          data-testid="checkout-total"
          className="font-heading text-3xl font-bold tabular-nums text-text sm:text-4xl"
        >
          <bdi>{moneyText(totalMinor, currency)}</bdi>
        </span>
      </div>
      {children}
    </div>
  );
}
