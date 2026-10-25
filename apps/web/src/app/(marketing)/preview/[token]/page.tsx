import { PreviewPage, previewMetadata } from "../../../../components/content/content-pages";

import type { Metadata } from "next";

// Drafts are rendered per request and never cached or indexed.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return previewMetadata();
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <PreviewPage token={(await params).token} />;
}
