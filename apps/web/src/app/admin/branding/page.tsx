import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { BrandingView } from "../../../components/admin/branding-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.branding") };

export default async function AdminBrandingPage() {
  const me = await requireMe("/admin/branding");
  if (!canAccess(me.permissions, "settings.read")) return <ForbiddenState />;
  return <BrandingView canWrite={canAccess(me.permissions, "settings.write")} />;
}
