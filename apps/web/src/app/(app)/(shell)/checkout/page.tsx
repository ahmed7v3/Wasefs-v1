import { t } from "@wasfa/shared/i18n";
import { quoteResponseSchema, type QuoteResponse } from "@wasfa/shared/schemas/billing";
import { mySubscriptionResponseSchema } from "@wasfa/shared/schemas/subscriptions";
import { buttonStyles } from "@wasfa/ui";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CheckoutForm } from "../../../../components/billing/checkout-form";
import { ErrorNotice } from "../../../../components/error-notice";
import { Notice } from "../../../../components/notice";
import { ApiRequestError } from "../../../../lib/api-error";
import { getCatalog, requestedCurrency } from "../../../../lib/billing-server";
import {
  orgFromParams,
  quoteCall,
  targetFromParams,
  type CheckoutTarget,
} from "../../../../lib/checkout-target";
import { requireOnboarded, serverApi } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("billing.checkout.title") };

type Params = Record<string, string | string[] | undefined>;

function ownPath(params: Params): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined) query.set(key, single);
  }
  const text = query.toString();
  return text ? `/checkout?${text}` : "/checkout";
}

function quoteOnServer(
  target: CheckoutTarget,
  methodKey: string | undefined,
  currency: string | undefined,
  orgId: string | undefined,
): Promise<QuoteResponse> {
  const { path, body } = quoteCall(target, { methodKey, currency, orgId });
  return serverApi(path, { method: "POST", body, schema: quoteResponseSchema });
}

function Unavailable({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold text-primary">{title}</h1>
      <Notice tone="warning">{body}</Notice>
      <Link
        href="/pricing"
        className={buttonStyles({ variant: "secondary", className: "self-start" })}
      >
        {t("billing.checkout.backToPricing")}
      </Link>
    </div>
  );
}

/**
 * The step before an order exists. The page is rendered with a real quote already in it, priced
 * with the first available payment method, so the summary and the Pay button's total are in the
 * very first response (BILLING §6.2) and a shopper without scripts still sees the honest total.
 */
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  await requireOnboarded(ownPath(params));
  const target = targetFromParams(params);
  if (!target) redirect("/pricing");

  const orgId = orgFromParams(params);
  const currency = await requestedCurrency(params);
  const [catalog, subscription] = await Promise.all([
    getCatalog(currency),
    target.kind === "renew"
      ? serverApi("/me/subscription", { schema: mySubscriptionResponseSchema })
      : Promise.resolve(null),
  ]);
  if (target.kind === "renew" && !subscription?.subscription) redirect("/billing");
  if (!catalog) {
    return (
      <Unavailable title={t("billing.checkout.title")} body={t("billing.checkout.unavailable")} />
    );
  }

  let quote: QuoteResponse;
  let methodKey: string | null;
  try {
    const first = catalog.methods[0]?.key;
    quote = await quoteOnServer(target, first, catalog.currency, orgId);
    // The first method may not fit this amount (its limits): start from the first one that does.
    const usable = quote.quote.methodOptions.find((option) => option.available)?.key;
    if (usable && usable !== first)
      quote = await quoteOnServer(target, usable, catalog.currency, orgId);
    methodKey = usable ?? null;
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "NOT_FOUND") {
      return (
        <Unavailable title={t("billing.checkout.title")} body={t("billing.checkout.notFound")} />
      );
    }
    if (error instanceof ApiRequestError) {
      return (
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <h1 className="font-heading text-2xl font-bold text-primary">
            {t("billing.checkout.title")}
          </h1>
          <ErrorNotice error={error} />
        </div>
      );
    }
    throw error;
  }

  const subjectName =
    target.kind === "plan"
      ? (catalog.plans.find((plan) => plan.key === target.planKey)?.names.ar ?? target.planKey)
      : target.kind === "pack"
        ? (catalog.creditPacks.find((pack) => pack.key === target.packKey)?.names.ar ??
          target.packKey)
        : (subscription?.subscription?.plan.nameAr ?? quote.quote.planKey);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold text-primary sm:text-3xl">
          {t("billing.checkout.title")}
        </h1>
        <p className="text-base text-text-muted">{t("billing.checkout.lead")}</p>
      </header>
      <CheckoutForm
        target={target}
        initial={quote}
        initialMethodKey={methodKey}
        methods={catalog.methods}
        subjectName={subjectName}
        currency={catalog.currency}
        refundWindowDays={catalog.billing.refundWindowDays}
        reviewSlaMinutes={catalog.billing.reviewSlaMinutes}
        orgId={orgId}
      />
    </div>
  );
}
