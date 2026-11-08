import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AdsAdvertisersView } from "../../../../components/admin/ads-advertisers-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.adsAdvertisers") };

export default async function AdminAdsAdvertisersPage() {
  const me = await requireMe("/admin/ads/advertisers");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <AdsAdvertisersView canWrite={canAccess(me.permissions, "ads.write")} />
    </Suspense>
  );
}
