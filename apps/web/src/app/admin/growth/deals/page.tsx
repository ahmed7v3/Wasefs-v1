import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { GrowthDealsView } from "../../../../components/admin/growth-deals-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.deals") };

export default async function AdminDealsPage() {
  const me = await requireMe("/admin/growth/deals");
  if (!canAccess(me.permissions, "referrals.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <GrowthDealsView canWrite={canAccess(me.permissions, "deals.write")} />
    </Suspense>
  );
}
