import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { AlertsView } from "../../../components/admin/alerts-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.alerts") };

export default async function AdminAlertsPage() {
  const me = await requireMe("/admin/alerts");
  if (!canAccess(me.permissions, "alerts.receive")) return <ForbiddenState />;
  return <AlertsView />;
}
