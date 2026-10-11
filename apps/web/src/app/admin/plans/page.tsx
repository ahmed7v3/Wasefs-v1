import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { PlansView } from "../../../components/admin/plans-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.plans.title") };

export default async function AdminPlansPage() {
  const me = await requireMe("/admin/plans");
  if (!canAccess(me.permissions, "plans.read")) return <ForbiddenState />;
  return (
    <PlansView
      canWrite={canAccess(me.permissions, "plans.write")}
      canSearchUsers={canAccess(me.permissions, "users.read")}
    />
  );
}
