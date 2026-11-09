import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { TelegramAdsAnalyticsView } from "../../../../components/admin/telegram-ads-analytics-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.tgAds.title") };

export default async function AdminTelegramAdsOverviewPage() {
  const me = await requireMe("/admin/telegram/ads");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return <TelegramAdsAnalyticsView />;
}
