import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forPharmacists", "ar");

export default function ForPharmacistsPage() {
  return <ProductPage pageKey="forPharmacists" locale="ar" />;
}
