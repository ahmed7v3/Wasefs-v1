import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featurePrescriptionReader", "ar");

export default function FeaturePrescriptionReaderPage() {
  return <ProductPage pageKey="featurePrescriptionReader" locale="ar" />;
}
