import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("forDoctors", "ar");

export default function ForDoctorsPage() {
  return <ProductPage pageKey="forDoctors" locale="ar" />;
}
