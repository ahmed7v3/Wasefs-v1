import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featureHandwrittenPrescriptions", "en");

export default function FeatureHandwrittenPrescriptionsEnPage() {
  return <ProductPage pageKey="featureHandwrittenPrescriptions" locale="en" />;
}
