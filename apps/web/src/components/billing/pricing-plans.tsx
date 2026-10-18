"use client";

import { t } from "@wasfa/shared/i18n";
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
import { useEffect, useId, useState } from "react";

import { fetchRecommendation } from "../../lib/billing-api";
import { checkoutHref } from "../../lib/checkout-target";
import { trackGrowth } from "../../lib/growth-events";
import { OffersCard } from "../growth/offers-card";
import { ValueLedger } from "../growth/value-ledger";

import type { CatalogResponse, RecommendationResponse } from "@wasfa/shared/schemas/billing";

type Plan = CatalogResponse["plans"][number];
type Promotion = CatalogResponse["promotions"][number];

export interface PricingPlansProps {
  currency: string;
  plans: readonly Plan[];
  promotions: readonly Promotion[];
  /** Monthly analyses of the free plan (`free_tier` setting). */
  freeMonthlyAnalyses: number;
  trialAvailable: boolean;
  /** Buying for this organization (`/pricing?org=`): checkout links carry it. */
  orgId?: string | undefined;
}

/** The free plan key the API uses for people without a paid plan. */
const FREE_PLAN_KEY = "free";

function planFeatures(plan: Plan): PlanCardFeature[] {
  const facts: PlanCardFeature[] = [
    {
      text: t("billing.plan.monthlyCredits", { count: plan.monthlyCredits }),
      included: true,
      highlight: true,
    },
  ];
  if (plan.maxMembers !== null) {
    facts.push({
      text: t("billing.plan.maxMembers", { count: plan.maxMembers }),
      included: true,
      highlight: false,
    });
  }
  return [
    ...facts,
    ...plan.features.map((feature) => ({
      text: feature.textAr,
      included: feature.included,
      highlight: feature.highlight,
    })),
  ];
}

function Recommendation({
  recommendation,
  plans,
  currency,
}: {
  recommendation: RecommendationResponse;
  plans: readonly Plan[];
  currency: string;
}) {
  const recommended = recommendation.recommended;
  const plan = recommended
    ? plans.find((candidate) => candidate.key === recommended.planKey)
    : null;
  if (recommendation.usage30dCredits <= 0 && !plan) return null;
  const cheaperThanPacks =
    recommended !== null &&
    recommendation.packPerCreditMinor !== null &&
    recommended.perCreditMinor < recommendation.packPerCreditMinor;
  return (
    <section
      aria-label={t("billing.recommend.title")}
      className="flex flex-col gap-1 rounded-xl border border-primary/30 bg-primary-soft p-4 sm:p-5"
    >
      <p className="inline-flex items-center gap-2 font-heading text-lg font-bold text-primary">
        <Sparkles aria-hidden className="size-5" />
        {t("billing.recommend.title")}
      </p>
      {recommendation.usage30dCredits > 0 ? (
        <p className="text-base text-text">
          {t("billing.recommend.usage", { count: recommendation.usage30dCredits })}
        </p>
      ) : null}
      {plan && recommended ? (
        <p className="text-base text-text">
          {cheaperThanPacks && recommendation.packPerCreditMinor !== null
            ? t("billing.recommend.plan", {
                plan: plan.names.ar,
                perCredit: moneyText(recommended.perCreditMinor, currency),
                pack: moneyText(recommendation.packPerCreditMinor, currency),
              })
            : t("billing.recommend.planSimple", { plan: plan.names.ar })}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The plan grid: free plus the paid plans of the catalog, monthly or annual (real savings from the
 * catalog), promotions with their server-side end time. The page around it is server-rendered and
 * cacheable; only the signed-in extras (current plan, «الأنسب لك») load here after mount.
 */
export function PricingPlans({
  currency,
  plans,
  promotions,
  freeMonthlyAnalyses,
  trialAvailable,
  orgId,
}: PricingPlansProps) {
  const [annual, setAnnual] = useState(false);
  const [recommendation, setRecommendation] = useState<RecommendationResponse | null>(null);
  const groupName = useId();

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

  const months = annual ? 12 : 1;
  const bestSavings = Math.max(0, ...plans.map((plan) => plan.annualSavingsMinor ?? 0));
  const currentKey = recommendation?.currentPlanKey ?? null;
  const recommendedKey = recommendation?.recommended?.planKey ?? null;
  const pinned = plans.find((plan) => plan.pinRecommended)?.key ?? null;
  const highlightKey = recommendedKey ?? pinned;
  const toggleBase =
    "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-5 text-base font-semibold transition-colors duration-150 has-[:focus-visible]:shadow-focus";

  return (
    <div className="flex flex-col gap-6">
      {recommendation ? (
        <>
          {/* Signed-in extras: the person's own value (GROWTH §7.4) and their personal offers. */}
          <ValueLedger />
          <OffersCard />
          <Recommendation recommendation={recommendation} plans={plans} currency={currency} />
        </>
      ) : null}

      {promotions.length > 0 ? (
        <ul aria-label={t("billing.promo.title")} className="flex flex-col gap-2">
          {promotions.map((promotion) => (
            <li
              key={promotion.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-success/30 bg-success-soft p-3 sm:p-4"
            >
              {promotion.badge ? <PromoBadge>{promotion.badge.ar}</PromoBadge> : null}
              <span className="text-base font-semibold text-text">{promotion.title.ar}</span>
              <Countdown endsAt={promotion.endsAt} />
            </li>
          ))}
        </ul>
      ) : null}

      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="sr-only">{t("billing.pricing.period")}</legend>
        <div className="inline-flex rounded-full bg-neutral-100 p-1">
          {([false, true] as const).map((value) => (
            <label
              key={String(value)}
              className={cn(
                toggleBase,
                annual === value ? "bg-primary text-on-primary" : "text-text hover:bg-primary-soft",
              )}
            >
              <input
                type="radio"
                name={groupName}
                checked={annual === value}
                onChange={() => {
                  setAnnual(value);
                }}
                className="sr-only"
              />
              {value ? t("billing.pricing.annual") : t("billing.pricing.monthly")}
            </label>
          ))}
        </div>
        {bestSavings > 0 ? (
          <Badge tone="success">
            {t("billing.pricing.annualSavings", { amount: moneyText(bestSavings, currency) })}
          </Badge>
        ) : null}
      </fieldset>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <li>
          <PlanCard
            name={t("billing.plan.free.name")}
            tagline={t("billing.plan.free.tagline")}
            badges={
              currentKey === FREE_PLAN_KEY ? (
                <Badge tone="info">{t("billing.plan.current")}</Badge>
              ) : null
            }
            price={
              <span className="font-heading text-3xl font-bold text-text">
                {t("billing.plan.free.price")}
              </span>
            }
            features={[
              {
                text: t("billing.plan.free.analyses", { count: freeMonthlyAnalyses }),
                included: true,
                highlight: true,
              },
              { text: t("billing.plan.free.noCard"), included: true, highlight: false },
            ]}
            cta={
              <Link
                href="/register"
                className={buttonStyles({ variant: "secondary", className: "w-full" })}
              >
                {t("billing.plan.free.cta")}
              </Link>
            }
          />
        </li>
        {plans.map((plan) => {
          const price =
            plan.prices.find((candidate) => candidate.months === months) ?? plan.prices[0];
          if (!price) return null;
          const promotion = price.promotionId
            ? promotions.find((candidate) => candidate.id === price.promotionId)
            : undefined;
          const current = currentKey === plan.key;
          const badges = (
            <>
              {recommendedKey === plan.key ? (
                <PromoBadge tone="info">{t("billing.recommend.badge")}</PromoBadge>
              ) : plan.pinRecommended ? (
                <PromoBadge tone="info">{t("billing.plan.pinned")}</PromoBadge>
              ) : null}
              {promotion?.badge ? <PromoBadge>{promotion.badge.ar}</PromoBadge> : null}
              {plan.badge ? <Badge tone="neutral">{plan.badge.ar}</Badge> : null}
              {current ? <Badge tone="info">{t("billing.plan.current")}</Badge> : null}
            </>
          );
          return (
            <li key={plan.key}>
              <PlanCard
                name={plan.names.ar}
                tagline={plan.tagline?.ar}
                badges={badges}
                highlighted={highlightKey === plan.key}
                price={
                  <PriceTag
                    amountMinor={price.display.headlineMinor}
                    currency={currency}
                    struckMinor={price.display.struckMinor}
                    suffix={`/ ${periodLabel(price.months)}`}
                  />
                }
                priceNote={
                  price.months > 1
                    ? t("billing.pricing.perMonth", {
                        amount: moneyText(price.display.perMonthMinor, currency),
                      })
                    : undefined
                }
                features={planFeatures(plan)}
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
                        variant: highlightKey === plan.key ? "primary" : "secondary",
                        className: "w-full",
                      })}
                      onClick={() => {
                        trackGrowth("plan_selected", { plan: plan.key, months: price.months }, true);
                      }}
                    >
                      {t("billing.plan.choose", { name: plan.names.ar })}
                    </Link>
                  )
                }
                footnote={
                  <>
                    {plan.trialDays > 0 && trialAvailable ? (
                      <span className="block">
                        {t("billing.plan.trial", { days: plan.trialDays })}
                      </span>
                    ) : null}
                    {plan.fairUseNote ? <span className="block">{plan.fairUseNote.ar}</span> : null}
                  </>
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
