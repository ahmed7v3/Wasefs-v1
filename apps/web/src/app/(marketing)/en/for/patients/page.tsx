import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forPatients", "en");

export default function ForPatientsEnPage() {
  return <ProductPage pageKey="forPatients" locale="en" />;
}
