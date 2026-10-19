import { t } from "@wasfa/shared/i18n";
import { cn, moneyText, periodLabel } from "@wasfa/ui";
import { CircleCheck, Circle } from "lucide-react";
import Link from "next/link";

import { checkoutHref } from "../../lib/checkout-target";
import { savingsPercent } from "../../lib/pricing-durations";

import type { CatalogPlan } from "@wasfa/shared/schemas/billing";

export interface CheckoutDurationsProps {
  plan: CatalogPlan;
  months: number;
  currency: string;
  orgId?: string | undefined;
}

/**
 * The period choice at checkout: every period the plan is sold for, each with its monthly rate,
 * what is paid now and the saving against monthly. Each option is a plain link to the same
 * checkout for that period, so the quote below is always the server's own for the chosen period.
 */
export function CheckoutDurations({ plan, months, currency, orgId }: CheckoutDurationsProps) {
  if (plan.prices.length < 2) return null;
  return (
    <nav aria-labelledby="checkout-period" className="flex flex-col gap-3">
      <h2 id="checkout-period" className="font-heading text-lg font-bold text-text">
        {t("billing.checkout.period")}
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {plan.prices.map((price) => {
          const active = price.months === months;
          const saving = savingsPercent(plan, price);
          const Icon = active ? CircleCheck : Circle;
          return (
            <li key={price.months}>
              <Link
                href={checkoutHref(
                  { kind: "plan", planKey: plan.key, months: price.months },
                  currency,
                  orgId,
                )}
                aria-current={active ? "true" : undefined}
                replace
                scroll={false}
                className={cn(
                  "flex h-full items-start gap-3 rounded-xl border p-4 transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus",
                  active
                    ? "border-primary bg-primary-soft ring-1 ring-primary"
                    : "border-border bg-surface hover:border-primary/50",
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    active ? "text-primary" : "text-text-muted",
                  )}
                />
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-base font-semibold text-text">
                      {periodLabel(price.months)}
                    </span>
                    {saving > 0 ? (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
                        {t("billing.pricing.savePercent", { percent: saving })}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-base text-text tabular-nums">
                    {t("billing.checkout.periodMonthly", {
                      amount: moneyText(price.display.perMonthMinor, currency),
                    })}
                  </span>
                  <span className="text-sm text-text-muted tabular-nums">
                    {t("billing.checkout.periodTotal", {
                      amount: moneyText(price.display.headlineMinor, currency),
                    })}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
