import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forPharmacists", "en");

export default function ForPharmacistsEnPage() {
  return <ProductPage pageKey="forPharmacists" locale="en" />;
}
