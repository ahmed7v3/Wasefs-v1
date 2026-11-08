import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { AdsOverviewView } from "../../../components/admin/ads-overview-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.adsOverview") };

export default async function AdminAdsPage() {
  const me = await requireMe("/admin/ads");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <AdsOverviewView canWrite={canAccess(me.permissions, "ads.write")} />
    </Suspense>
  );
}
