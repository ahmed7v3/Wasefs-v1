"use client";

import type { Locale } from "@wasfa/shared/i18n";
import { t as translate, type MessageKey } from "@wasfa/shared/i18n/public";
import {
  Badge,
  Countdown,
  PlanCard,
  PriceTag,
  PromoBadge,
  buttonStyles,
  cn,
  moneyText,
  periodLabel,
  type PlanCardFeature,
} from "@wasfa/ui";
import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState, type ReactNode } from "react";

import { fetchRecommendation } from "../../lib/billing-api";
import { checkoutHref } from "../../lib/checkout-target";
import { trackGrowth } from "../../lib/growth-events";
import {
  bestSavingsPercent,
  defaultDuration,
  durationLabel,
  featureText,
  offeredDurations,
  planOffer,
} from "../../lib/pricing-durations";

import type {
  CatalogFreePlan,
  CatalogResponse,
  RecommendationResponse,
} from "@wasfa/shared/schemas/billing";

type Plan = CatalogResponse["plans"][number];
type Promotion = CatalogResponse["promotions"][number];

/** `t` bound to the page language (Arabic by default, English on `/en/pricing`). */
function boundT(locale: Locale) {
  return (key: MessageKey, params?: Record<string, string | number>) =>
    translate(key, params, locale);
}

export interface PricingPlansProps {
  currency: string;
  plans: readonly Plan[];
  /** The admin's default plan when it is on sale; null = no free card. */
  freePlan: CatalogFreePlan | null;
  promotions: readonly Promotion[];
  trialAvailable: boolean;
  /** The currency control, shown under the period switcher. */
  currencySwitch?: ReactNode;
  /** `?period=` on the page: the period to open on when it is sold. */
  initialMonths?: number | undefined;
  /** Buying for this organization (`/pricing?org=`): checkout links carry it. */
  orgId?: string | undefined;
  /** Page language: copy, plan names, number format. Checkout itself stays Arabic. */
  locale?: Locale | undefined;
}

/** Included features only: what is missing is in the comparison table, not on the card. */
function includedFeatures(
  monthlyCredits: number,
  maxMembers: number | null,
  features: Plan["features"],
  locale: Locale,
): PlanCardFeature[] {
  const t = boundT(locale);
  return [
    {
      text: t("billing.plan.monthlyCredits", { count: monthlyCredits }),
      included: true,
      highlight: true,
    },
    ...(maxMembers !== null
      ? [
          {
            text: t("billing.plan.maxMembers", { count: maxMembers }),
            included: true,
            highlight: false,
          },
        ]
      : []),
    ...features
      .filter((feature) => feature.included)
      .map((feature) => ({
        text: featureText(feature, locale),
        included: true,
        highlight: feature.highlight,
      })),
  ];
}

/** The signed-in hint: which plan fits the person's own use. One calm line, never a banner wall. */
function Recommendation({
  recommendation,
  plans,
  currency,
  locale,
}: {
  recommendation: RecommendationResponse;
  plans: readonly Plan[];
  currency: string;
  locale: Locale;
}) {
  const t = boundT(locale);
  const recommended = recommendation.recommended;
  const plan = recommended
    ? plans.find((candidate) => candidate.key === recommended.planKey)
    : null;
  if (!plan || !recommended) return null;
  const cheaperThanPacks =
    recommendation.packPerCreditMinor !== null &&
    recommended.perCreditMinor < recommendation.packPerCreditMinor;
  return (
    <p className="mx-auto flex max-w-reading items-start gap-2 rounded-xl bg-primary-soft px-4 py-3 text-base text-text">
      <Sparkles aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
      <span>
        {recommendation.usage30dCredits > 0
          ? `${t("billing.recommend.usage", { count: recommendation.usage30dCredits })} `
          : null}
        {cheaperThanPacks && recommendation.packPerCreditMinor !== null
          ? t("billing.recommend.plan", {
              plan: plan.names[locale],
              perCredit: moneyText(recommended.perCreditMinor, currency, locale),
              pack: moneyText(recommendation.packPerCreditMinor, currency, locale),
            })
          : t("billing.recommend.planSimple", { plan: plan.names[locale] })}
      </span>
    </p>
  );
}

/** The period switcher: every duration the admin priced, with the best saving it brings. */
function DurationSwitch({
  durations,
  value,
  plans,
  onChange,
  locale,
}: {
  durations: readonly number[];
  value: number;
  plans: readonly Plan[];
  onChange: (months: number) => void;
  locale: Locale;
}) {
  const t = boundT(locale);
  const groupName = useId();
  if (durations.length < 2) return null;
  return (
    <fieldset className="flex flex-col items-center gap-2">
      <legend className="mb-2 w-full text-center text-sm font-semibold text-text-muted">
        {t("billing.pricing.period")}
      </legend>
      <div className="flex max-w-full flex-wrap justify-center gap-1 rounded-2xl bg-neutral-100 p-1.5">
        {durations.map((months) => {
          const saving = bestSavingsPercent(plans, months);
          const active = value === months;
          return (
            <label
              key={months}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors duration-150 has-[:focus-visible]:shadow-focus",
                active ? "bg-surface text-primary shadow-card" : "text-text hover:bg-surface/60",
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={months}
                checked={active}
                onChange={() => {
                  onChange(months);
                }}
                className="sr-only"
              />
              {durationLabel(months, locale)}
              {saving > 0 ? (
                <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success">
                  {t("billing.pricing.savePercent", { percent: saving })}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The plan grid: the free plan (as the admin set it up) and the paid plans of the catalog for one
 * billing period at a time. Each card leads with the effective monthly price for that period and
 * says plainly what is paid upfront; the period switcher lists exactly the periods that are sold.
 */
export function PricingPlans({
  currency,
  plans,
  freePlan,
  promotions,
  trialAvailable,
  initialMonths,
  currencySwitch,
  orgId,
  locale = "ar",
}: PricingPlansProps) {
  const t = boundT(locale);
  const durations = offeredDurations(plans);
  const [months, setMonths] = useState<number>(() =>
    initialMonths !== undefined && durations.includes(initialMonths)
      ? initialMonths
      : (defaultDuration(durations) ?? 1),
  );
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);

  useEffect(() => {
    trackGrowth("pricing_viewed", { currency, ...(orgId ? { org: true } : {}) });
  }, [currency, orgId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchRecommendation(currency, controller.signal)
      .then(setRecommendation)
      // Signed out (401) or the API is away: the page simply stays the public one.
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [currency]);

  const currentKey = recommendation?.currentPlanKey ?? null;
  const recommendedKey = recommendation?.recommended?.planKey ?? null;
  const pinnedKey = plans.find((plan) => plan.pinRecommended)?.key ?? null;
  const highlightKey = recommendedKey ?? pinnedKey;
  const cards = (freePlan ? 1 : 0) + plans.length;

  return (
    <div className="flex flex-col gap-8">
      {promotions.length > 0 ? (
        <ul aria-label={t("billing.promo.title")} className="flex flex-col items-center gap-2">
          {promotions.map((promotion) => (
            <li
              key={promotion.id}
              className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-success/30 bg-success-soft px-4 py-2 text-center"
            >
              {promotion.badge ? <PromoBadge>{promotion.badge[locale]}</PromoBadge> : null}
              <span className="text-base font-semibold text-text">{promotion.title[locale]}</span>
              <Countdown endsAt={promotion.endsAt} locale={locale} />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col items-center gap-3">
        <DurationSwitch
          durations={durations}
          value={months}
          plans={plans}
          onChange={setMonths}
          locale={locale}
        />
        {currencySwitch}
      </div>

      {recommendation ? (
        <Recommendation
          recommendation={recommendation}
          plans={plans}
          currency={currency}
          locale={locale}
        />
      ) : null}

      <ul
        className={cn(
          "grid gap-6 pt-4",
          cards <= 1
            ? "mx-auto w-full max-w-md"
            : cards === 2
              ? "mx-auto w-full max-w-4xl md:grid-cols-2"
              : cards === 3
                ? "md:grid-cols-2 lg:grid-cols-3"
                : "md:grid-cols-2 xl:grid-cols-4",
        )}
      >
        {freePlan ? (
          <li>
            <PlanCard
              name={freePlan.names[locale]}
              locale={locale}
              tagline={freePlan.tagline?.[locale] ?? t("billing.plan.free.tagline")}
              badges={
                <>
                  {freePlan.badge ? <Badge tone="neutral">{freePlan.badge[locale]}</Badge> : null}
                  {currentKey === freePlan.key ? (
                    <Badge tone="info">{t("billing.plan.current")}</Badge>
                  ) : null}
                </>
              }
              price={
                <span className="font-heading text-4xl font-bold text-text">
                  {t("billing.plan.free.price")}
                </span>
              }
              priceNote={t("billing.plan.free.note")}
              featuresTitle={t("billing.plan.includes")}
              features={includedFeatures(freePlan.monthlyCredits, null, freePlan.features, locale)}
              cta={
                currentKey === freePlan.key ? (
                  <Link
                    href="/dashboard"
                    className={buttonStyles({ variant: "secondary", className: "w-full" })}
                  >
                    {t("billing.plan.free.current")}
                  </Link>
                ) : currentKey !== null ? null : (
                  <Link
                    href="/register"
                    className={buttonStyles({ variant: "secondary", className: "w-full" })}
                  >
                    {t("billing.plan.free.cta")}
                  </Link>
                )
              }
            />
          </li>
        ) : null}
        {plans.map((plan) => {
          const offer = planOffer(plan, months);
          if (!offer) return null;
          const { price } = offer;
          const promotion = price.promotionId
            ? promotions.find((candidate) => candidate.id === price.promotionId)
            : undefined;
          const current = currentKey === plan.key;
          const highlighted = highlightKey === plan.key;
          const struckPerMonth =
            price.display.struckMinor !== null
              ? Math.floor(price.display.struckMinor / price.months)
              : null;
          return (
            <li key={plan.key}>
              <PlanCard
                name={plan.names[locale]}
                locale={locale}
                tagline={plan.tagline?.[locale]}
                highlighted={highlighted}
                ribbon={
                  recommendedKey === plan.key
                    ? t("billing.recommend.badge")
                    : highlighted
                      ? t("billing.plan.pinned")
                      : null
                }
                badges={
                  <>
                    {promotion?.badge ? <PromoBadge>{promotion.badge[locale]}</PromoBadge> : null}
                    {plan.badge ? <Badge tone="neutral">{plan.badge[locale]}</Badge> : null}
                    {current ? <Badge tone="info">{t("billing.plan.current")}</Badge> : null}
                  </>
                }
                price={
                  <PriceTag
                    amountMinor={price.display.perMonthMinor}
                    currency={currency}
                    struckMinor={struckPerMonth}
                    locale={locale}
                    suffix={t("billing.pricing.perMonthSuffix")}
                    size="xl"
                  />
                }
                priceNote={
                  <span className="flex flex-col gap-1">
                    <span>
                      {price.months === 1
                        ? t("billing.pricing.billedMonthly")
                        : t("billing.pricing.billedUpfront", {
                            amount: moneyText(price.display.headlineMinor, currency, locale),
                            period: periodLabel(price.months, locale),
                          })}
                    </span>
                    {offer.savingsPercent > 0 ? (
                      <span className="font-semibold text-success">
                        {t("billing.pricing.savingsVsMonthly", { percent: offer.savingsPercent })}
                      </span>
                    ) : null}
                    {!offer.exact ? (
                      <span>
                        {t("billing.pricing.onlyPeriod", {
                          period: periodLabel(price.months, locale),
                        })}
                      </span>
                    ) : null}
                  </span>
                }
                featuresTitle={t("billing.plan.includes")}
                features={includedFeatures(
                  plan.monthlyCredits,
                  plan.maxMembers,
                  plan.features,
                  locale,
                )}
                cta={
                  current ? (
                    <Link
                      href="/billing"
                      className={buttonStyles({ variant: "secondary", className: "w-full" })}
                    >
                      {t("billing.plan.manage")}
                    </Link>
                  ) : (
                    <Link
                      href={checkoutHref(
                        { kind: "plan", planKey: plan.key, months: price.months },
                        currency,
                        orgId,
                      )}
                      className={buttonStyles({
                        variant: highlighted ? "primary" : "secondary",
                        size: "lg",
                        className: "w-full",
                      })}
                      onClick={() => {
                        trackGrowth(
                          "plan_selected",
                          { plan: plan.key, months: price.months },
                          true,
                        );
                      }}
                    >
                      {t("billing.plan.choose", { name: plan.names[locale] })}
                    </Link>
                  )
                }
                footnote={
                  plan.trialDays > 0 && trialAvailable
                    ? t("billing.plan.trial", { days: plan.trialDays })
                    : undefined
                }
                finePrint={plan.fairUseNote?.[locale]}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
