import { t } from "@wasfa/shared/i18n";

import { PricingView } from "../../../../components/billing/pricing-view";
import { pageMetadata } from "../../../../lib/seo";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata(
  "pricing",
  {
    title: t("billing.pricing.title", undefined, "en"),
    description: t("billing.pricing.description", undefined, "en"),
  },
  "en",
);

export default function EnglishPricingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PricingView locale="en" searchParams={searchParams} />;
}
