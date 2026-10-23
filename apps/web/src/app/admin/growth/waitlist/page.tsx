import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { GrowthWaitlistView } from "../../../../components/admin/growth-waitlist-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.waitlist") };

export default async function AdminWaitlistPage() {
  const me = await requireMe("/admin/growth/waitlist");
  if (!canAccess(me.permissions, "users.read")) return <ForbiddenState />;
  return <GrowthWaitlistView />;
}
