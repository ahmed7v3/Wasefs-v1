import { t } from "@wasfa/shared/i18n";

import { PricingView } from "../../../components/billing/pricing-view";
import { pageMetadata } from "../../../lib/seo";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("pricing", {
  title: t("billing.pricing.title"),
  description: t("billing.pricing.description"),
});

export default function PricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PricingView locale="ar" searchParams={searchParams} />;
}
