import { t } from "@wasfa/shared/i18n";
import { Card, ComparisonTable, Container, PriceTag, buttonStyles, periodLabel } from "@wasfa/ui";
import { ChevronDown, MessageCircle } from "lucide-react";
import Link from "next/link";

import { CurrencySwitch } from "../../../components/billing/currency-switch";
import { OrgLeadDialog } from "../../../components/billing/org-lead-dialog";
import { PricingPlans } from "../../../components/billing/pricing-plans";
import { JsonLd } from "../../../components/marketing/json-ld";
import { Notice } from "../../../components/notice";
import { getCatalog, requestedCurrency } from "../../../lib/billing-server";
import { checkoutHref, orgFromParams } from "../../../lib/checkout-target";
import { contactLinks } from "../../../lib/contact-links";
import { publicEnv } from "../../../lib/env";
import { getNonce } from "../../../lib/nonce";
import { comparisonModel } from "../../../lib/pricing-compare";
import { getPublicSettings } from "../../../lib/public-settings";
import { pageMetadata } from "../../../lib/seo";
import { faqJsonLd, productJsonLd } from "../../../lib/structured-data";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("pricing", {
  title: t("billing.pricing.title"),
  description: t("billing.pricing.description"),
});

const FAQ = [
  { question: "billing.faq.price.q", answer: "billing.faq.price.a" },
  { question: "billing.faq.privacy.q", answer: "billing.faq.privacy.a" },
  { question: "billing.faq.cancel.q", answer: "billing.faq.cancel.a" },
  { question: "billing.faq.invoice.q", answer: "billing.faq.invoice.a" },
] as const;

/**
 * Public pricing page (Task 3.7). Server-rendered from the catalog, which is cached per currency;
 * nothing here depends on who is looking, so the signed-in extras (current plan, «الأنسب لك»)
 * arrive client-side inside `PricingPlans`.
 */
export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orgId = orgFromParams(params);
  const currencyParam = await requestedCurrency(params);
  const [catalog, settings, nonce] = await Promise.all([
    getCatalog(currencyParam),
    getPublicSettings(),
    getNonce(),
  ]);
  const siteUrl = publicEnv.NEXT_PUBLIC_SITE_URL;

  if (!catalog) {
    return (
      <Container className="py-12 sm:py-16">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("billing.pricing.title")}
        </h1>
        <Notice tone="warning" className="mt-6">
          {t("billing.pricing.unavailable")}
        </Notice>
      </Container>
    );
  }

  const { currency, plans, promotions, creditPacks, tax, billing } = catalog;
  const comparison = comparisonModel(plans, settings.free_tier.monthlyAnalyses);
  const whatsapp = contactLinks(settings.contact).find((link) => link.channel === "whatsapp");
  const organisationPlan = plans.find((plan) => plan.audience === "organization");
  const faq = FAQ.map((entry) => ({ question: t(entry.question), answer: t(entry.answer) }));

  return (
    <>
      <JsonLd
        nonce={nonce}
        data={productJsonLd(settings, siteUrl, {
          name: t("billing.pricing.productName"),
          description: t("billing.pricing.description"),
          offers: plans.flatMap((plan) =>
            plan.prices.map((price) => ({
              name: `${plan.names.ar} - ${periodLabel(price.months)}`,
              amountMinor: price.display.headlineMinor,
              currency,
            })),
          ),
        })}
      />
      <JsonLd nonce={nonce} data={faqJsonLd(faq)} />

      <Container className="flex flex-col gap-12 py-10 sm:gap-16 sm:py-16">
        <header className="flex flex-col gap-3">
          <h1 className="font-heading text-3xl font-bold leading-snug text-primary sm:text-5xl">
            {t("billing.pricing.title")}
          </h1>
          <p className="max-w-reading text-lg text-text-muted">{t("billing.pricing.lead")}</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-base font-semibold text-text">
            <li>{t("billing.trust.noCard")}</li>
            <li>{t("billing.trust.noAutoRenew")}</li>
            {billing.refundWindowDays > 0 ? (
              <li>{t("billing.trust.refund", { days: billing.refundWindowDays })}</li>
            ) : null}
            <li>{t("billing.trust.methods")}</li>
          </ul>
        </header>

        <section aria-labelledby="plans-title" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 id="plans-title" className="font-heading text-2xl font-bold text-text">
              {t("billing.pricing.plans")}
            </h2>
            <CurrencySwitch current={currency} options={settings.currency.enabled} />
          </div>
          <PricingPlans
            currency={currency}
            plans={plans}
            promotions={promotions}
            freeMonthlyAnalyses={settings.free_tier.monthlyAnalyses}
            trialAvailable={billing.trialAvailable}
            orgId={orgId}
          />
          {plans.length === 0 ? (
            <Notice tone="info">{t("billing.pricing.noPlans")}</Notice>
          ) : null}
          {tax.mode !== "none" ? (
            <p className="text-sm text-text-muted">
              {tax.mode === "inclusive" ? t("billing.tax.inclusive") : t("billing.tax.added")}
            </p>
          ) : null}
        </section>

        {creditPacks.length > 0 ? (
          <section aria-labelledby="packs-title" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 id="packs-title" className="font-heading text-2xl font-bold text-text">
                {t("billing.packs.title")}
              </h2>
              <p className="text-base text-text-muted">{t("billing.packs.lead")}</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-3">
              {creditPacks.map((pack) => (
                <li key={pack.key}>
                  <Card elevation="card" padding="compact" className="flex h-full flex-col gap-3">
                    <h3 className="font-heading text-lg font-bold text-text">{pack.names.ar}</h3>
                    <p className="text-base text-text-muted">
                      {pack.bonusCredits > 0
                        ? t("billing.packs.withBonus", {
                            credits: pack.credits,
                            bonus: pack.bonusCredits,
                          })
                        : t("billing.packs.credits", { credits: pack.credits })}
                    </p>
                    <PriceTag amountMinor={pack.amountMinor} currency={currency} size="lg" />
                    <p className="text-sm text-text-muted">
                      {t("billing.packs.valid", { months: pack.validMonths })}
                    </p>
                    <Link
                      href={checkoutHref({ kind: "pack", packKey: pack.key }, currency, orgId)}
                      className={buttonStyles({
                        variant: "secondary",
                        className: "mt-auto w-full",
                      })}
                    >
                      {t("billing.packs.buy", { name: pack.names.ar })}
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {plans.length > 0 ? (
          <section aria-labelledby="compare-title" className="flex flex-col gap-4">
            <h2 id="compare-title" className="font-heading text-2xl font-bold text-text">
              {t("billing.compare.title")}
            </h2>
            <ComparisonTable
              caption={t("billing.compare.title")}
              columns={comparison.columns}
              rows={comparison.rows}
            />
          </section>
        ) : null}

        <section
          aria-labelledby="org-title"
          className="flex flex-col gap-3 rounded-xl border border-border/60 bg-surface p-5 shadow-card sm:p-8"
        >
          <h2 id="org-title" className="font-heading text-2xl font-bold text-text">
            {t("billing.org.title")}
          </h2>
          <p className="max-w-reading text-base text-text-muted">
            {organisationPlan
              ? t("billing.org.leadWithPlan", {
                  plan: organisationPlan.names.ar,
                  members: organisationPlan.maxMembers ?? 0,
                  credits: organisationPlan.monthlyCredits,
                })
              : t("billing.org.lead")}
          </p>
          <div>
            <OrgLeadDialog nonce={nonce} />
          </div>
        </section>

        <section aria-labelledby="faq-title" className="flex flex-col gap-4">
          <h2 id="faq-title" className="font-heading text-2xl font-bold text-text">
            {t("billing.faq.title")}
          </h2>
          <div className="flex flex-col gap-2">
            {faq.map((entry) => (
              <details
                key={entry.question}
                className="group rounded-xl border border-border/60 bg-surface px-4 py-1 shadow-card"
              >
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-md font-heading text-lg font-semibold text-text focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                  {entry.question}
                  <ChevronDown
                    aria-hidden
                    className="size-5 shrink-0 text-text-muted transition-transform duration-150 group-open:rotate-180"
                  />
                </summary>
                <p className="pb-3 text-base text-text-muted">{entry.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {whatsapp ? (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-primary-soft p-5 sm:p-8">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading text-xl font-bold text-primary">
                {t("billing.help.title")}
              </h2>
              <p className="text-base text-text">{t("billing.help.lead")}</p>
            </div>
            <a
              href={whatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ size: "lg" })}
            >
              <MessageCircle aria-hidden className="size-5" />
              {t("billing.help.choose")}
            </a>
          </section>
        ) : null}
      </Container>
    </>
  );
}
