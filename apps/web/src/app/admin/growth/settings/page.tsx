import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { SettingsView } from "../../../../components/admin/settings-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.growthSettings") };

export default async function AdminGrowthSettingsPage() {
  const me = await requireMe("/admin/growth/settings");
  if (!canAccess(me.permissions, "settings.read")) return <ForbiddenState />;
  return (
    <SettingsView
      canWrite={canAccess(me.permissions, "settings.write")}
      keys={["rewards", "growth"]}
    />
  );
}
