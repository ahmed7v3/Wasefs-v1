import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { RoutesView } from "../../../../components/admin/routes-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.routes.title") };

export default async function AdminAiRoutesPage() {
  const me = await requireMe("/admin/ai/routes");
  if (!canAccess(me.permissions, "ai.read")) return <ForbiddenState />;
  return (
    <RoutesView
      canWrite={canAccess(me.permissions, "ai.write")}
      canReadPlans={canAccess(me.permissions, "plans.read")}
    />
  );
}
