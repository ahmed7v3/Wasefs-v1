import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { AuditView } from "../../../components/admin/audit-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.audit") };

export default async function AdminAuditPage() {
  const me = await requireMe("/admin/audit");
  if (!canAccess(me.permissions, "audit.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <AuditView />
    </Suspense>
  );
}
