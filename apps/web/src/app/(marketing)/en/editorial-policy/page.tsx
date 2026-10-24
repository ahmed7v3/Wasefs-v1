import { ProductPage, productPageMetadata } from "../../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("editorialPolicy", "en");

export default function EditorialPolicyEnPage() {
  return <ProductPage pageKey="editorialPolicy" locale="en" />;
}
