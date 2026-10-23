import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featureHandwrittenPrescriptions", "ar");

export default function FeatureHandwrittenPrescriptionsPage() {
  return <ProductPage pageKey="featureHandwrittenPrescriptions" locale="ar" />;
}
