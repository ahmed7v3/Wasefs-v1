import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AdsWhatsappView } from "../../../../components/admin/ads-whatsapp-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.adsWhatsapp") };

export default async function AdminAdsWhatsappPage() {
  const me = await requireMe("/admin/ads/whatsapp");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <AdsWhatsappView canWrite={canAccess(me.permissions, "ads.write")} />
    </Suspense>
  );
}
