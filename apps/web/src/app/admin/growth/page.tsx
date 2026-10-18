import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { GrowthOverviewView } from "../../../components/admin/growth-overview-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.growthOverview") };

export default async function AdminGrowthPage() {
  const me = await requireMe("/admin/growth");
  if (!canAccess(me.permissions, "referrals.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <GrowthOverviewView canReadFunnel={canAccess(me.permissions, "billing.read")} />
    </Suspense>
  );
}
