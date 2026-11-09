import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../../components/admin/access-state";
import { TelegramAdsCreativesView } from "../../../../../components/admin/telegram-ads-creatives-view";
import { canAccess } from "../../../../../lib/admin-nav";
import { requireMe } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.tgAds.creatives.title") };

export default async function AdminTelegramAdsCreativesPage() {
  const me = await requireMe("/admin/telegram/ads/creatives");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return <TelegramAdsCreativesView canWrite={canAccess(me.permissions, "ads.write")} />;
}
