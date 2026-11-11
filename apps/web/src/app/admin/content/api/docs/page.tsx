import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../../components/admin/access-state";
import { PublishingDocsView } from "../../../../../components/admin/publishing-docs-view";
import { canAccess } from "../../../../../lib/admin-nav";
import { requireMe } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.apiDocs") };

export default async function AdminPublishingDocsPage() {
  const me = await requireMe("/admin/content/api/docs");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return <PublishingDocsView />;
}
