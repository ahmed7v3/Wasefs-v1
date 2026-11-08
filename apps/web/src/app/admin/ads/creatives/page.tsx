import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AdsCreativesView } from "../../../../components/admin/ads-creatives-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.adsCreatives") };

export default async function AdminAdsCreativesPage() {
  const me = await requireMe("/admin/ads/creatives");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <AdsCreativesView canWrite={canAccess(me.permissions, "ads.write")} />
    </Suspense>
  );
}
