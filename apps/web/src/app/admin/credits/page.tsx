import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { CreditsView } from "../../../components/admin/credits-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.credits.title") };

export default async function AdminCreditsPage() {
  const me = await requireMe("/admin/credits");
  if (!canAccess(me.permissions, "usage.read")) return <ForbiddenState />;
  return (
    <CreditsView
      canAdjust={canAccess(me.permissions, "credits.adjust")}
      canReadAi={canAccess(me.permissions, "ai.read")}
      canReadPlans={canAccess(me.permissions, "plans.read")}
    />
  );
}
