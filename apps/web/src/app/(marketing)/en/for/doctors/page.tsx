import { ProductPage, productPageMetadata } from "../../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forDoctors", "en");

export default function ForDoctorsEnPage() {
  return <ProductPage pageKey="forDoctors" locale="en" />;
}
