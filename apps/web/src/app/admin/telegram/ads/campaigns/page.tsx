import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../../components/admin/access-state";
import { TelegramAdsCampaignsView } from "../../../../../components/admin/telegram-ads-campaigns-view";
import { canAccess } from "../../../../../lib/admin-nav";
import { requireMe } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.tgAds.campaigns.title") };

export default async function AdminTelegramAdsCampaignsPage() {
  const me = await requireMe("/admin/telegram/ads/campaigns");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return <TelegramAdsCampaignsView canWrite={canAccess(me.permissions, "ads.write")} />;
}
