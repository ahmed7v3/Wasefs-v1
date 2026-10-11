import { LegalPage } from "../../../components/marketing/legal-page";
import { terms } from "../../../content/legal/terms";
import { pageMetadata } from "../../../lib/seo";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("terms", {
  title: terms.title,
  description: terms.description,
});

export default function TermsPage() {
  return <LegalPage doc={terms} />;
}
