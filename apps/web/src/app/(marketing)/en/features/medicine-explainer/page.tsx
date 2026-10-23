import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featureMedicineExplainer", "en");

export default function FeatureMedicineExplainerEnPage() {
  return <ProductPage pageKey="featureMedicineExplainer" locale="en" />;
}
