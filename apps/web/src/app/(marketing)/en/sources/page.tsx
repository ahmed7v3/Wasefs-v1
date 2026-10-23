import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("sources", "en");

export default function SourcesEnPage() {
  return <ProductPage pageKey="sources" locale="en" />;
}
