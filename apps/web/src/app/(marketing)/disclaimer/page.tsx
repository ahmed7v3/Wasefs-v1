import { LegalPage } from "../../../components/marketing/legal-page";
import { disclaimer } from "../../../content/legal/disclaimer";
import { pageMetadata } from "../../../lib/seo";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("disclaimer", {
  title: disclaimer.title,
  description: disclaimer.description,
});

export default function DisclaimerPage() {
  return <LegalPage doc={disclaimer} />;
}
