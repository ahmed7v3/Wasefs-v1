import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { SettingsView } from "../../../components/admin/settings-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";
import { GENERAL_SETTINGS_GROUPS } from "../../../lib/setting-meta";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.settings") };

export default async function AdminSettingsPage() {
  const me = await requireMe("/admin/settings");
  if (!canAccess(me.permissions, "settings.read")) return <ForbiddenState />;
  return (
    <SettingsView
      canWrite={canAccess(me.permissions, "settings.write")}
      groups={GENERAL_SETTINGS_GROUPS}
    />
  );
}
