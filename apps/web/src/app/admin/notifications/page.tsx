import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { NotificationsHealth } from "../../../components/admin/notifications-health";
import { SettingsView } from "../../../components/admin/settings-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.notifications") };

/** Whether alerts arrive and why not (`alerts.receive`), then the alert settings (`settings.read`). */
export default async function AdminNotificationsPage() {
  const me = await requireMe("/admin/notifications");
  const health = canAccess(me.permissions, "alerts.receive");
  const settings = canAccess(me.permissions, "settings.read");
  if (!health && !settings) return <ForbiddenState />;
  return (
    <div className="flex flex-col gap-8">
      {health ? <NotificationsHealth /> : null}
      {settings ? (
        <SettingsView canWrite={canAccess(me.permissions, "settings.write")} keys={["alerts"]} />
      ) : null}
    </div>
  );
}
