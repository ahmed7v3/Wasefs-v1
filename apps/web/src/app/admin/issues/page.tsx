import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { IssuesView } from "../../../components/admin/issues-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.issues") };

export default async function AdminIssuesPage() {
  const me = await requireMe("/admin/issues");
  if (!canAccess(me.permissions, "issues.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <IssuesView />
    </Suspense>
  );
}
