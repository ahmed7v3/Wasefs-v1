import { t } from "@wasfa/shared/i18n";
import { moneyText } from "@wasfa/ui";

import { tOr } from "./admin-format";

/*
 * Pure helpers of the revenue and pricing screens: nothing here decides a price (the API is the
 * authority), they only turn numbers the API returned into the words and deltas an admin reads.
 */

export type Direction = "up" | "down" | "flat";

export interface Delta {
  direction: Direction;
  /** Basis points of change versus the prior period; `null` when there is no base to compare. */
  bps: number | null;
}

/** Change of `current` versus `previous` in basis points of the previous value. */
export function deltaOf(current: number, previous: number): Delta {
  if (current === previous) return { direction: "flat", bps: 0 };
  if (previous === 0) return { direction: current > previous ? "up" : "down", bps: null };
  const bps = Math.round(((current - previous) * 10_000) / Math.abs(previous));
  return { direction: bps > 0 ? "up" : "down", bps };
}

/** "12.5%" from basis points. */
export function percentText(bps: number): string {
  const value = bps / 100;
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)}%`;
}

/** A short duration from seconds: "3 ساعات". */
export function durationText(seconds: number): string {
  if (seconds < 60) return t("admin.revenue.duration.seconds", { count: seconds });
  if (seconds < 3_600) {
    return t("admin.revenue.duration.minutes", { count: Math.round(seconds / 60) });
  }
  if (seconds < 86_400) {
    return t("admin.revenue.duration.hours", { count: Math.round(seconds / 3_600) });
  }
  return t("admin.revenue.duration.days", { count: Math.round(seconds / 86_400) });
}

/** Whole seconds from `now` to an ISO time (negative once it has passed). */
export function remainingSeconds(isoTime: string, now: number = Date.now()): number {
  return Math.floor((Date.parse(isoTime) - now) / 1_000);
}

/** `mm:ss` countdown of the account-change cooldown. */
export function clockText(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export interface DiscountRuleInput {
  kind: string;
  value: number;
  currency: string | null;
  planNames: readonly string[];
  months: readonly number[];
  audience: string;
  countries: readonly string[];
  newCustomersOnly: boolean;
  minAmountMinor: number | null;
  maxRedemptions: number | null;
  perOwnerLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  stacking: string;
}

function valueText(rule: DiscountRuleInput): string {
  switch (rule.kind) {
    case "percent":
      return t("admin.revenue.rule.percent", { value: percentText(rule.value) });
    case "fixed":
      return t("admin.revenue.rule.fixed", {
        value: moneyText(rule.value, rule.currency ?? "EGP"),
      });
    case "bonus_credits":
      return t("admin.revenue.rule.bonusCredits", { value: rule.value });
    case "extra_months":
      return t("admin.revenue.rule.extraMonths", { value: rule.value });
    default:
      return t("admin.revenue.rule.trialDays", { value: rule.value });
  }
}

const dayFormat = new Intl.DateTimeFormat("ar-EG", {
  numberingSystem: "latn",
  year: "numeric",
  month: "short",
  day: "numeric",
});

/** The plain-language summary of a promotion or coupon: what, where, for whom, when, how many. */
export function discountSentence(rule: DiscountRuleInput): string {
  const parts: string[] = [valueText(rule)];
  parts.push(
    rule.planNames.length > 0
      ? t("admin.revenue.rule.onPlans", { plans: rule.planNames.join("، ") })
      : t("admin.revenue.rule.onAllPlans"),
  );
  if (rule.months.length > 0) {
    parts.push(t("admin.revenue.rule.forMonths", { months: rule.months.join("، ") }));
  }
  if (rule.audience === "individual") parts.push(t("admin.revenue.rule.individuals"));
  if (rule.audience === "organization") parts.push(t("admin.revenue.rule.organizations"));
  if (rule.countries.length > 0) {
    parts.push(t("admin.revenue.rule.inCountries", { countries: rule.countries.join("، ") }));
  }
  if (rule.newCustomersOnly) parts.push(t("admin.revenue.rule.newOnly"));
  if (rule.minAmountMinor !== null) {
    parts.push(
      t("admin.revenue.rule.minAmount", {
        amount: moneyText(rule.minAmountMinor, rule.currency ?? "EGP"),
      }),
    );
  }
  if (rule.startsAt) {
    parts.push(t("admin.revenue.rule.from", { date: dayFormat.format(new Date(rule.startsAt)) }));
  }
  if (rule.endsAt) {
    parts.push(t("admin.revenue.rule.until", { date: dayFormat.format(new Date(rule.endsAt)) }));
  }
  if (rule.maxRedemptions !== null) {
    parts.push(t("admin.revenue.rule.limit", { count: rule.maxRedemptions }));
  }
  if (rule.perOwnerLimit !== null) {
    parts.push(t("admin.revenue.rule.perOwner", { count: rule.perOwnerLimit }));
  }
  parts.push(
    rule.stacking === "stack_with_other"
      ? t("admin.revenue.rule.stacks")
      : t("admin.revenue.rule.exclusive"),
  );
  return `${parts.join(t("admin.revenue.rule.separator"))}.`;
}

/** CSV text to its data rows (the header line and blank lines are not counted). */
export function csvDataRows(csv: string): string[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(1);
}

export interface CheckoutPreviewInput {
  amountMinor: number;
  tax: { rateBps: number; mode: "added" | "inclusive" } | null;
  method: { feeBps: number; feeFixedMinor: number } | null;
}

export interface CheckoutPreviewResult {
  taxMinor: number;
  feeMinor: number;
  totalMinor: number;
}

const roundHalfUp = (numerator: number, denominator: number) =>
  Math.floor((numerator * 2 + denominator) / (denominator * 2));

/**
 * How checkout will show a sample amount under the current tax rule and method fee: the combined
 * "tax and fees" line and the total. A display aid for the preview only - the engine prices orders.
 */
export function previewCheckout(input: CheckoutPreviewInput): CheckoutPreviewResult {
  const { amountMinor, tax, method } = input;
  let taxMinor = 0;
  let base = amountMinor;
  if (tax && tax.rateBps > 0) {
    if (tax.mode === "added") {
      taxMinor = roundHalfUp(amountMinor * tax.rateBps, 10_000);
      base = amountMinor + taxMinor;
    } else {
      taxMinor = roundHalfUp(amountMinor * tax.rateBps, 10_000 + tax.rateBps);
    }
  }
  const feeMinor = method ? roundHalfUp(base * method.feeBps, 10_000) + method.feeFixedMinor : 0;
  return { taxMinor, feeMinor, totalMinor: base + feeMinor };
}

/** A payment flag as words: `duplicate_image_sha256:WSO-2026-000123` names the earlier order it matches. */
export function flagText(flag: string): string {
  const [base = flag, ref = ""] = flag.split(":");
  return tOr(`admin.revenue.review.flag.${base}`, flag, { ref });
}
