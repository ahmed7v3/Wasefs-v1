import { ProductPage, productPageMetadata } from "../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("sources", "ar");

export default function SourcesPage() {
  return <ProductPage pageKey="sources" locale="ar" />;
}
