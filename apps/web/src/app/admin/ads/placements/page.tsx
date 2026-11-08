import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AdsPlacementsView } from "../../../../components/admin/ads-placements-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.adsPlacements") };

export default async function AdminAdsPlacementsPage() {
  const me = await requireMe("/admin/ads/placements");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <AdsPlacementsView canWrite={canAccess(me.permissions, "ads.write")} />
    </Suspense>
  );
}
