import { planMargin, type PlanMargin } from "@wasfa/shared/margin";
import { toMinor } from "@wasfa/shared/money";

import { cellKey, type MatrixDraft } from "./price-matrix";

import type { MethodView, TaxRuleView } from "./admin-billing-schemas";

/*
 * Margin display aids for the plan editor (BILLING §2.3). `planMargin` from the shared package is the
 * very function the API uses on Publish, so the numbers agree; the API stays the authority and
 * refuses a negative margin without an explicit override.
 */

export const MARGIN_WARN_BPS = 5_000;

export interface MarginAssumptions {
  taxMode: "added" | "inclusive" | null;
  taxRateBps: number;
  feeBps: number;
}

/**
 * The tax rule and gateway fee the estimate assumes: the active default tax rule and the highest
 * fee among enabled methods (the conservative case).
 */
export function marginAssumptions(
  rules: readonly TaxRuleView[],
  methods: readonly MethodView[],
): MarginAssumptions {
  const rule =
    rules.find((entry) => entry.active && entry.country === null) ??
    rules.find((entry) => entry.active);
  const fees = methods.filter((method) => method.enabled).map((method) => method.feeBps);
  return {
    taxMode: rule?.mode ?? null,
    taxRateBps: rule?.rateBps ?? 0,
    feeBps: fees.length > 0 ? Math.max(...fees) : 0,
  };
}

export interface MarginRow {
  months: number;
  currency: string;
  margin: PlanMargin;
}

export interface MarginInput {
  matrix: MatrixDraft;
  months: readonly number[];
  currencies: readonly string[];
  monthlyCredits: number;
  /** 0 to 100: the share of the monthly credits customers actually use. */
  utilisationPercent: number;
  costPerCreditUsdMicros: number;
  fxUsdToEgp: number;
  assumptions: MarginAssumptions;
}

/** The margin of every priced cell (EGP and USD only: the estimate needs the FX rate) at a utilisation. */
export function marginRows(input: MarginInput): MarginRow[] {
  const rows: MarginRow[] = [];
  const used = Math.round((input.monthlyCredits * input.utilisationPercent) / 100);
  for (const months of input.months) {
    for (const currency of input.currencies) {
      const text = (input.matrix[cellKey(months, currency)] ?? "").trim();
      if (text === "") continue;
      let amountMinor: number;
      try {
        amountMinor = toMinor(text, currency);
      } catch {
        continue;
      }
      const margin = planMargin({
        amountMinor,
        months,
        currency,
        monthlyCredits: used,
        costPerCreditUsdMicros: input.costPerCreditUsdMicros,
        fxUsdToEgp: input.fxUsdToEgp,
        taxMode: input.assumptions.taxMode,
        taxRateBps: input.assumptions.taxRateBps,
        feeBps: input.assumptions.feeBps,
      });
      if (margin) rows.push({ months, currency, margin });
    }
  }
  return rows;
}

/**
 * The share of the monthly credits customers could use before the plan stops earning anything:
 * 100 % of the credits cost `breakEvenBps` of the revenue, so break-even is 10000 / breakEvenBps.
 * `null` when the credits cost nothing (never breaks even).
 */
export function breakEvenUtilisationPercent(fullUseCostBps: number): number | null {
  if (fullUseCostBps <= 0) return null;
  return Math.round(1_000_000 / fullUseCostBps);
}

export type MarginTone = "success" | "warning" | "danger";

export function marginTone(marginBps: number): MarginTone {
  if (marginBps < 0) return "danger";
  return marginBps < MARGIN_WARN_BPS ? "warning" : "success";
}
