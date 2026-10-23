import { ProductPage, productPageMetadata } from "../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("medicalReview", "ar");

export default function MedicalReviewPage() {
  return <ProductPage pageKey="medicalReview" locale="ar" />;
}
