import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forClinics", "en");

export default function ForClinicsEnPage() {
  return <ProductPage pageKey="forClinics" locale="en" />;
}
