import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { ContentListView } from "../../../components/admin/content-list-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.articles") };

export default async function AdminContentPage() {
  const me = await requireMe("/admin/content");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentListView meId={me.id} permissions={me.permissions} />
    </Suspense>
  );
}
