import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featureAiAssistant", "en");

export default function FeatureAiAssistantEnPage() {
  return <ProductPage pageKey="featureAiAssistant" locale="en" />;
}
