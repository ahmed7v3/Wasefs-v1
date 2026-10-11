import { LegalPage } from "../../../components/marketing/legal-page";
import { privacy } from "../../../content/legal/privacy";
import { pageMetadata } from "../../../lib/seo";

import type { Metadata } from "next";

export const metadata: Metadata = pageMetadata("privacy", {
  title: privacy.title,
  description: privacy.description,
});

export default function PrivacyPage() {
  return <LegalPage doc={privacy} />;
}
