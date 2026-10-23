import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { SiteHealthView } from "../../../components/admin/site-health-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.siteHealth") };

export default async function AdminSiteHealthPage() {
  const me = await requireMe("/admin/site-health");
  if (!canAccess(me.permissions, "settings.read")) return <ForbiddenState />;
  return <SiteHealthView />;
}
