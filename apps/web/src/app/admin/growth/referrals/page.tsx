import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { GrowthReferralsView } from "../../../../components/admin/growth-referrals-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.referrals") };

export default async function AdminGrowthReferralsPage() {
  const me = await requireMe("/admin/growth/referrals");
  if (!canAccess(me.permissions, "referrals.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <GrowthReferralsView canWrite={canAccess(me.permissions, "referrals.write")} />
    </Suspense>
  );
}
