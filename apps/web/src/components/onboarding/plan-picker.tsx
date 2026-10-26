"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, Button, PriceTag, cn, moneyText, periodLabel } from "@wasfa/ui";
import { useId, useState, type ReactNode } from "react";

import { checkoutHref } from "../../lib/checkout-target";
import { trackGrowth } from "../../lib/growth-events";
import {
  defaultDuration,
  featureText,
  offeredDurations,
  planOffer,
} from "../../lib/pricing-durations";
import { DurationSwitch } from "../billing/pricing-plans";
import { ErrorNotice } from "../error-notice";

import { useStepAction } from "./use-step-action";
import { StepActions } from "./wizard-parts";

import type { StepProps } from "./steps";
import type { CatalogResponse } from "@wasfa/shared/schemas/billing";

type Plan = CatalogResponse["plans"][number];

/** Highlights per paid card: the cards stay compact in the narrow onboarding column. */
const MAX_HIGHLIGHTS = 3;

function PlanOption({
  name,
  value,
  checked,
  onSelect,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer flex-col gap-2 rounded-xl border bg-surface p-4 transition-colors duration-150",
        "border-neutral-400 hover:border-neutral-600",
        "has-[:checked]:border-primary has-[:checked]:bg-primary-soft",
        "has-[:focus-visible]:shadow-focus",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {children}
    </label>
  );
}

/**
 * The last wizard step: the free plan (preselected) and the paid plans of the catalog that fit the
 * account. Free finishes onboarding; a paid choice is recorded and the user lands on checkout.
 */
export function PlanPicker({ state, submit, onBack, catalog, freeMonthlyAnalyses }: StepProps) {
  const groupName = useId();
  const organization = state.answers.accountType === "organization";
  const audiences: readonly Plan["audience"][] = organization
    ? ["organization", "any"]
    : ["individual", "any"];
  const plans = (catalog?.plans ?? []).filter(
    (plan) => audiences.includes(plan.audience) && plan.prices.length > 0,
  );
  const durations = offeredDurations(plans);
  const [months, setMonths] = useState<number>(() => defaultDuration(durations) ?? 1);
  /** `null` = the free plan. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const currency = catalog?.currency;
  const freePlan = catalog?.freePlan ?? null;

  const action = useStepAction<undefined>(async () => {
    const plan = selectedKey === null ? undefined : plans.find((item) => item.key === selectedKey);
    // The card may show another period when the plan is not sold for the switcher's one: buy what it shows.
    const offer = plan ? planOffer(plan, months) : null;
    if (!plan || !offer || !currency) {
      // Free finishes onboarding, so the spinner says the plan is being activated.
      await submit(
        "plan_picker",
        { plan: "free" },
        { doneMessage: t("onboarding.plan.activating") },
      );
      return;
    }
    const paidMonths = offer.price.months;
    trackGrowth("plan_selected", { plan: plan.key, months: paidMonths }, true);
    const orgId = organization ? state.answers.organization?.id : undefined;
    await submit(
      "plan_picker",
      { plan: "paid", planKey: plan.key, months: paidMonths },
      {
        next: checkoutHref(
          { kind: "plan", planKey: plan.key, months: paidMonths },
          currency,
          orgId,
        ),
        doneMessage: t("onboarding.plan.toCheckout"),
      },
    );
  });
  const freeSelected = selectedKey === null;

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        action.start(undefined);
      }}
    >
      {plans.length > 0 ? (
        <DurationSwitch
          durations={durations}
          value={months}
          plans={plans}
          onChange={setMonths}
          locale="ar"
        />
      ) : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{t("onboarding.plan.optionsLabel")}</legend>
        <PlanOption
          name={groupName}
          value="free"
          checked={freeSelected}
          onSelect={() => {
            setSelectedKey(null);
          }}
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-heading text-lg font-semibold text-text">
              {freePlan?.names.ar ?? t("onboarding.plan.free")}
            </span>
            <span className="text-lg font-bold text-text">{t("onboarding.plan.freePrice")}</span>
          </span>
          <span className="text-base text-text tabular-nums">
            {t("billing.plan.monthlyCredits", {
              count: freePlan?.monthlyCredits ?? freeMonthlyAnalyses,
            })}
          </span>
          <span className="text-sm text-text-muted">{t("onboarding.plan.freeNote")}</span>
        </PlanOption>
        {currency
          ? plans.map((plan) => {
              const offer = planOffer(plan, months);
              if (!offer) return null;
              const { price } = offer;
              const badge =
                plan.badge?.ar ?? (plan.pinRecommended ? t("billing.plan.pinned") : null);
              const highlights = plan.features
                .filter((feature) => feature.included && feature.highlight)
                .slice(0, MAX_HIGHLIGHTS);
              return (
                <PlanOption
                  key={plan.key}
                  name={groupName}
                  value={plan.key}
                  checked={selectedKey === plan.key}
                  onSelect={() => {
                    setSelectedKey(plan.key);
                  }}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-heading text-lg font-semibold text-text">
                        {plan.names.ar}
                      </span>
                      {badge ? <Badge tone="neutral">{badge}</Badge> : null}
                    </span>
                    <PriceTag
                      amountMinor={price.display.perMonthMinor}
                      currency={currency}
                      locale="ar"
                      suffix={t("billing.pricing.perMonthSuffix")}
                      size="md"
                    />
                  </span>
                  <span className="text-base text-text tabular-nums">
                    {t("billing.plan.monthlyCredits", { count: plan.monthlyCredits })}
                  </span>
                  <span className="text-sm text-text-muted">
                    {price.months === 1
                      ? t("billing.pricing.billedMonthly")
                      : t("billing.pricing.billedUpfront", {
                          amount: moneyText(price.display.headlineMinor, currency, "ar"),
                          period: periodLabel(price.months, "ar"),
                        })}
                  </span>
                  {highlights.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-sm text-text">
                      {highlights.map((feature) => (
                        <li key={feature.textAr}>{featureText(feature, "ar")}</li>
                      ))}
                    </ul>
                  ) : null}
                </PlanOption>
              );
            })
          : null}
      </fieldset>
      {action.error ? <ErrorNotice error={action.error} /> : null}
      <StepActions onBack={onBack} submitLabel="">
        <Button
          type="submit"
          size="lg"
          name="next"
          loading={action.busy}
          className="w-full sm:w-auto"
        >
          {freeSelected ? t("onboarding.plan.startFree") : t("onboarding.plan.continuePaid")}
        </Button>
      </StepActions>
      <p className="text-center text-sm text-text-muted">{t("onboarding.plan.changeLater")}</p>
    </form>
  );
}
