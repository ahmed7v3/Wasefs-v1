import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { GrowthFraudView } from "../../../../components/admin/growth-fraud-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.fraud") };

export default async function AdminGrowthFraudPage() {
  const me = await requireMe("/admin/growth/fraud");
  if (!canAccess(me.permissions, "referrals.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <GrowthFraudView canWrite={canAccess(me.permissions, "referrals.write")} />
    </Suspense>
  );
}
