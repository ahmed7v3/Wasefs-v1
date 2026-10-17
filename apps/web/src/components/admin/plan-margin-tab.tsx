"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, moneyText } from "@wasfa/ui";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { type AdminPlan } from "../../lib/admin-billing-schemas";
import { percentText } from "../../lib/admin-revenue";
import {
  MARGIN_WARN_BPS,
  breakEvenUtilisationPercent,
  marginRows,
  marginTone,
  type MarginAssumptions,
} from "../../lib/plan-margin";
import { type MatrixDraft } from "../../lib/price-matrix";

export interface PlanMarginTabProps {
  plan: AdminPlan;
  matrix: MatrixDraft;
  months: readonly number[];
  currencies: readonly string[];
  monthlyCredits: number;
  assumptions: MarginAssumptions;
}

const TONE_ICON = { success: CircleCheck, warning: TriangleAlert, danger: CircleX } as const;

/**
 * The margin calculator of BILLING §2.3: for each price in the draft, what is left after tax, the
 * gateway fee and the AI cost of the credits the customer uses. The slider is the share of the
 * monthly credits used; a margin under 50 % warns, a negative one needs an override on Publish.
 */
export function PlanMarginTab({
  plan,
  matrix,
  months,
  currencies,
  monthlyCredits,
  assumptions,
}: PlanMarginTabProps) {
  const sliderId = useId();
  const [utilisation, setUtilisation] = useState(60);
  const rows = marginRows({
    matrix,
    months,
    currencies,
    monthlyCredits,
    utilisationPercent: utilisation,
    costPerCreditUsdMicros: plan.marginInputs.costPerCreditUsdMicros,
    fxUsdToEgp: plan.marginInputs.fxUsdToEgp,
    assumptions,
  });
  // Cost of full use relative to revenue, read from the same prices at 100 % utilisation.
  const full = marginRows({
    matrix,
    months,
    currencies,
    monthlyCredits,
    utilisationPercent: 100,
    costPerCreditUsdMicros: plan.marginInputs.costPerCreditUsdMicros,
    fxUsdToEgp: plan.marginInputs.fxUsdToEgp,
    assumptions,
  });
  const cell = "border-b border-border px-3 py-2 text-start tabular-nums";

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-text-muted">{t("admin.pricing.margin.lead")}</p>
      <div className="flex flex-col gap-2">
        <label htmlFor={sliderId} className="text-base font-semibold">
          {t("admin.pricing.margin.utilisation", { percent: utilisation })}
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={utilisation}
          onChange={(event) => {
            setUtilisation(Number(event.target.value));
          }}
          className="w-full accent-primary"
        />
        <p className="text-sm text-text-muted">
          {t("admin.pricing.margin.inputs", {
            credits: monthlyCredits,
            tax: assumptions.taxMode
              ? `${percentText(assumptions.taxRateBps)} (${t(`admin.pricing.margin.tax.${assumptions.taxMode}`)})`
              : t("admin.pricing.margin.tax.none"),
            fee: percentText(assumptions.feeBps),
          })}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-base text-text-muted">{t("admin.pricing.margin.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-96 border-collapse text-base">
            <caption className="sr-only">{t("admin.pricing.margin.caption")}</caption>
            <thead>
              <tr className="bg-neutral-50 text-sm text-text-muted">
                <th scope="col" className={cell}>
                  {t("admin.pricing.margin.col.price")}
                </th>
                <th scope="col" className={cell}>
                  {t("admin.pricing.margin.col.cost")}
                </th>
                <th scope="col" className={cell}>
                  {t("admin.pricing.margin.col.margin")}
                </th>
                <th scope="col" className={cell}>
                  {t("admin.pricing.margin.col.breakEven")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tone = marginTone(row.margin.marginBps);
                const Icon = TONE_ICON[tone];
                const fullCost = full.find(
                  (entry) => entry.months === row.months && entry.currency === row.currency,
                );
                const breakEven = fullCost
                  ? breakEvenUtilisationPercent(fullCost.margin.breakEvenBps)
                  : null;
                return (
                  <tr key={`${String(row.months)}-${row.currency}`}>
                    <th scope="row" className={`${cell} font-semibold`}>
                      {t("admin.pricing.matrix.months", { count: row.months })} ·{" "}
                      <bdi dir="ltr">{row.currency}</bdi>
                    </th>
                    <td className={cell}>{moneyText(row.margin.costFullMinor, row.currency)}</td>
                    <td className={cell}>
                      <Badge tone={tone}>
                        <Icon aria-hidden className="size-3.5" />
                        {percentText(row.margin.marginBps)}
                        <span className="sr-only"> {t(`admin.pricing.margin.tone.${tone}`)}</span>
                      </Badge>
                    </td>
                    <td className={cell}>
                      {breakEven === null
                        ? t("admin.pricing.margin.neverBreaks")
                        : breakEven > 1_000
                          ? t("admin.pricing.margin.neverRealistic")
                          : `${String(breakEven)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-text-muted">
        {t("admin.pricing.margin.warnNote", { percent: MARGIN_WARN_BPS / 100 })}
      </p>
    </div>
  );
}
