import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { SettingsView } from "../../../../components/admin/settings-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.billingSettings") };

export default async function AdminBillingSettingsPage() {
  const me = await requireMe("/admin/billing/settings");
  if (!canAccess(me.permissions, "settings.read")) return <ForbiddenState />;
  return <SettingsView canWrite={canAccess(me.permissions, "settings.write")} keys={["billing"]} />;
}
