import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { PublishingKeysView } from "../../../../components/admin/publishing-keys-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.apiKeys") };

export default async function AdminPublishingKeysPage() {
  const me = await requireMe("/admin/content/api-keys");
  if (!canAccess(me.permissions, "content.api_keys")) return <ForbiddenState />;
  return <PublishingKeysView />;
}
