import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { GrowthPromptsView } from "../../../../components/admin/growth-prompts-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.growthPrompts") };

export default async function AdminGrowthPromptsPage() {
  const me = await requireMe("/admin/growth/prompts");
  if (!canAccess(me.permissions, "referrals.read")) return <ForbiddenState />;
  return <GrowthPromptsView canWrite={canAccess(me.permissions, "promotions.write")} />;
}
