import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { ContentRedirectsView } from "../../../../components/admin/content-redirects-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.redirects") };

export default async function AdminContentRedirectsPage() {
  const me = await requireMe("/admin/content/redirects");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentRedirectsView permissions={me.permissions} />
    </Suspense>
  );
}
