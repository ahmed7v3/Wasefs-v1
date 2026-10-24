import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("medicalReview", "en");

export default function MedicalReviewEnPage() {
  return <ProductPage pageKey="medicalReview" locale="en" />;
}
