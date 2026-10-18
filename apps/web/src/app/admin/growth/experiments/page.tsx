import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { GrowthExperimentsView } from "../../../../components/admin/growth-experiments-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.experiments") };

export default async function AdminGrowthExperimentsPage() {
  const me = await requireMe("/admin/growth/experiments");
  if (!canAccess(me.permissions, "referrals.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <GrowthExperimentsView canWrite={canAccess(me.permissions, "promotions.write")} />
    </Suspense>
  );
}
