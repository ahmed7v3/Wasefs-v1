import { ProductPage, productPageMetadata } from "../../../components/marketing/product-page";

import type { Metadata } from "next";

export const metadata: Metadata = productPageMetadata("editorialPolicy", "ar");

export default function EditorialPolicyPage() {
  return <ProductPage pageKey="editorialPolicy" locale="ar" />;
}
