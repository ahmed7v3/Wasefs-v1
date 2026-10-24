import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("about", "en");

export default function AboutEnPage() {
  return <ProductPage pageKey="about" locale="en" />;
}
