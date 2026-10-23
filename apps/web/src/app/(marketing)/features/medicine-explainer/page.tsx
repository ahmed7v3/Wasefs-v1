import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featureMedicineExplainer", "ar");

export default function FeatureMedicineExplainerPage() {
  return <ProductPage pageKey="featureMedicineExplainer" locale="ar" />;
}
