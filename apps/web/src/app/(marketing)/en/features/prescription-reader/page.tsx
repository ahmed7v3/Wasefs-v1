import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("featurePrescriptionReader", "en");

export default function FeaturePrescriptionReaderEnPage() {
  return <ProductPage pageKey="featurePrescriptionReader" locale="en" />;
}
