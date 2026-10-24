import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forPatients", "ar");

export default function ForPatientsPage() {
  return <ProductPage pageKey="forPatients" locale="ar" />;
}
