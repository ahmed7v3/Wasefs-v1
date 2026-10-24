import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forClinics", "ar");

export default function ForClinicsPage() {
  return <ProductPage pageKey="forClinics" locale="ar" />;
}
