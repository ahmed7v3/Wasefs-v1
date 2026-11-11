import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { PublishingConnectView } from "../../../../components/admin/publishing-connect-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.apiConnect") };

export default async function AdminPublishingConnectPage() {
  const me = await requireMe("/admin/content/api");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return <PublishingConnectView />;
}
