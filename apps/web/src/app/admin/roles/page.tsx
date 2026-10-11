import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { RolesView } from "../../../components/admin/roles-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.roles") };

export default async function AdminRolesPage() {
  const me = await requireMe("/admin/roles");
  if (!canAccess(me.permissions, "roles.read")) return <ForbiddenState />;
  return <RolesView isSuperAdmin={me.roles.includes("super_admin")} />;
}
