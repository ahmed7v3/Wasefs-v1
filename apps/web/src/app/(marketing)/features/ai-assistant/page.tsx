import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featureAiAssistant", "ar");

export default function FeatureAiAssistantPage() {
  return <ProductPage pageKey="featureAiAssistant" locale="ar" />;
}
