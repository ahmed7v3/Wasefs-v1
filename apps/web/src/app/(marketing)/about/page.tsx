import { ProductPage, productPageMetadata } from "../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("about", "ar");

export default function AboutPage() {
  return <ProductPage pageKey="about" locale="ar" />;
}
