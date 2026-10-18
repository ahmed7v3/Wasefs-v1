import { t } from "@wasfa/shared/i18n";
import { meCreditsResponseSchema } from "@wasfa/shared/schemas/credits";
import { mySubscriptionResponseSchema } from "@wasfa/shared/schemas/subscriptions";
import { Badge, Card, PriceTag, buttonStyles, periodLabel } from "@wasfa/ui";
import { CalendarClock, Coins, MessageCircle } from "lucide-react";
import Link from "next/link";

import { OrderHistory } from "../../../../components/billing/order-history";
import { SubscriptionActions } from "../../../../components/billing/subscription-actions";
import { PayerLine } from "../../../../components/workspace/payer-line";
import { getCatalog, requestedCurrency } from "../../../../lib/billing-server";
import { checkoutHref } from "../../../../lib/checkout-target";
import { contactLinks } from "../../../../lib/contact-links";
import { formatDate } from "../../../../lib/dates";
import { getPublicSettings } from "../../../../lib/public-settings";
import { requireOnboarded, serverApi } from "../../../../lib/session";
import { payerView } from "../../../../lib/wallet-view";
import { creditsPath } from "../../../../lib/workspace";
import { requestedWorkspace } from "../../../../lib/workspace-server";

import type { SubscriptionView } from "@wasfa/shared/schemas/subscriptions";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: t("billing.account.title") };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="font-heading text-xl font-bold text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The state chips of a subscription: its status plus "will not renew" and a scheduled change. */
function StatusChips({ subscription }: { subscription: SubscriptionView }) {
  const end = formatDate(subscription.currentPeriodEnd);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {subscription.status === "trialing" ? (
        <Badge tone="info">{t("billing.account.status.trialing")}</Badge>
      ) : subscription.status === "grace" ? (
        <Badge tone="warning">
          {t("billing.account.status.grace", {
            date: formatDate(subscription.graceUntil ?? subscription.currentPeriodEnd),
          })}
        </Badge>
      ) : subscription.status === "active" ? (
        <Badge tone="success">{t("billing.account.status.active")}</Badge>
      ) : (
        <Badge tone="neutral">{t(`billing.account.status.${subscription.status}`)}</Badge>
      )}
      {subscription.cancelAtPeriodEnd ? (
        <Badge tone="warning">{t("billing.account.willEnd", { date: end })}</Badge>
      ) : null}
    </div>
  );
}

export default async function BillingPage() {
  const me = await requireOnboarded("/billing");
  const orgId = await requestedWorkspace(me);
  const currency = await requestedCurrency({});
  const [mine, credits, catalog, settings] = await Promise.all([
    serverApi("/me/subscription", { schema: mySubscriptionResponseSchema }),
    serverApi(creditsPath(orgId), { schema: meCreditsResponseSchema }),
    getCatalog(currency),
    getPublicSettings(),
  ]);
  const subscription = mine.subscription;
  const plans = catalog?.plans ?? [];
  const names: Record<string, string> = {};
  for (const plan of plans) names[plan.key] = plan.names.ar;
  for (const pack of catalog?.creditPacks ?? []) names[pack.key] = pack.names.ar;
  if (subscription) names[subscription.plan.key] = subscription.plan.nameAr;

  const currentKey = subscription?.plan.key ?? credits.plan.key;
  const currentIndex = plans.findIndex((plan) => plan.key === currentKey);
  // Plans listed after the current one in the catalog's order are the ones above it; the
  // organisation plan is bought by organisations, not offered as a personal upgrade.
  const upgrades = plans
    .filter((plan, index) => index > currentIndex && plan.audience !== "organization")
    .map((plan) => ({
      key: plan.key,
      name: plan.names.ar,
      href: checkoutHref({ kind: "plan", planKey: plan.key, months: 1 }, catalog?.currency),
    }));
  const trials =
    mine.trialAvailable && !subscription
      ? plans
          .filter((plan) => plan.trialDays > 0)
          .map((plan) => ({ key: plan.key, name: plan.names.ar, days: plan.trialDays }))
      : [];
  const nextGrant = subscription?.nextCreditGrantAt ?? credits.nextGrantAt;
  const whatsapp = contactLinks(settings.contact).find((link) => link.channel === "whatsapp");
  const pending = subscription?.pendingChange ?? null;
  const payer = payerView(credits);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold text-primary sm:text-4xl">
          {t("billing.account.title")}
        </h1>
        <p className="text-base text-text-muted sm:text-lg">{t("billing.account.lead")}</p>
      </header>

      <Section id="plan-title" title={t("billing.account.planTitle")}>
        <Card elevation="card" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-heading text-2xl font-bold text-text" data-testid="current-plan">
              {subscription ? subscription.plan.nameAr : credits.plan.nameAr}
            </p>
            {subscription ? <StatusChips subscription={subscription} /> : null}
          </div>
          {subscription ? (
            <ul className="flex flex-col gap-1.5 text-base text-text-muted">
              <li className="flex items-center gap-2">
                <CalendarClock aria-hidden className="size-4 shrink-0" />
                {t("billing.account.periodEnd", {
                  date: formatDate(subscription.currentPeriodEnd),
                })}
                {subscription.monthsPaid > 0 ? ` · ${periodLabel(subscription.monthsPaid)}` : ""}
              </li>
              {pending ? (
                <li>
                  {t("billing.account.pendingChange", {
                    plan: names[pending.planKey] ?? pending.planKey,
                    date: formatDate(pending.effectiveAt),
                  })}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-base text-text-muted">{t("billing.account.freeLead")}</p>
          )}
          <SubscriptionActions
            hasSubscription={subscription !== null}
            canRenew={subscription !== null && subscription.status !== "trialing"}
            cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
            periodEnd={subscription ? formatDate(subscription.currentPeriodEnd) : null}
            upgrades={upgrades}
            trials={trials}
          />
          {subscription ? null : (
            <Link
              href="/pricing"
              className={buttonStyles({ variant: "secondary", className: "self-start" })}
            >
              {t("billing.account.seePlans")}
            </Link>
          )}
        </Card>
      </Section>

      <Section id="credits-title" title={t("billing.account.creditsTitle")}>
        <Card elevation="card" className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-heading text-3xl font-bold tabular-nums text-text">
            <Coins aria-hidden className="size-6 text-primary" />
            <span data-testid="credit-balance">
              {t("dashboard.credits.balance", { balance: payer.balance })}
            </span>
          </p>
          <PayerLine payer={payer} />
          <p className="text-base text-text-muted">
            {t("billing.account.monthlyCredits", { count: credits.monthlyCredits })} ·{" "}
            {t("billing.account.nextGrant", { date: formatDate(nextGrant) })}
          </p>
        </Card>
      </Section>

      {catalog && catalog.creditPacks.length > 0 ? (
        <Section id="packs-title" title={t("billing.packs.title")}>
          <p className="text-base text-text-muted">{t("billing.packs.lead")}</p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {catalog.creditPacks.map((pack) => (
              <li key={pack.key}>
                <Card elevation="flat" padding="compact" className="flex h-full flex-col gap-2">
                  <h3 className="font-heading text-lg font-bold text-text">{pack.names.ar}</h3>
                  <p className="text-sm text-text-muted">
                    {pack.bonusCredits > 0
                      ? t("billing.packs.withBonus", {
                          credits: pack.credits,
                          bonus: pack.bonusCredits,
                        })
                      : t("billing.packs.credits", { credits: pack.credits })}
                  </p>
                  <PriceTag amountMinor={pack.amountMinor} currency={catalog.currency} size="md" />
                  <Link
                    href={checkoutHref({ kind: "pack", packKey: pack.key }, catalog.currency)}
                    className={buttonStyles({ variant: "secondary", className: "mt-auto" })}
                  >
                    {t("billing.packs.buy", { name: pack.names.ar })}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="orders-title" title={t("billing.orders.title")}>
        <OrderHistory names={names} />
      </Section>

      <Section id="help-title" title={t("billing.account.helpTitle")}>
        <div className="flex flex-col gap-3 rounded-xl bg-primary-soft p-4 sm:p-5">
          <p className="text-base text-text">{t("billing.account.helpBody")}</p>
          {catalog && catalog.billing.refundWindowDays > 0 ? (
            <p className="text-sm text-text-muted">
              {t("billing.trust.refund", { days: catalog.billing.refundWindowDays })}
            </p>
          ) : null}
          {whatsapp ? (
            <a
              href={whatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ variant: "secondary", className: "self-start" })}
            >
              <MessageCircle aria-hidden className="size-4" />
              {t("billing.help.whatsapp")}
            </a>
          ) : (
            <Link
              href="/contact"
              className={buttonStyles({ variant: "secondary", className: "self-start" })}
            >
              {t("common.contactSupport")}
            </Link>
          )}
        </div>
      </Section>
    </div>
  );
}
