import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../../components/admin/access-state";
import { TelegramAdsSettingsView } from "../../../../../components/admin/telegram-ads-settings-view";
import { canAccess } from "../../../../../lib/admin-nav";
import { requireMe } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.tgAds.settings.title") };

export default async function AdminTelegramAdsSettingsPage() {
  const me = await requireMe("/admin/telegram/ads/settings");
  if (!canAccess(me.permissions, "ads.read")) return <ForbiddenState />;
  return <TelegramAdsSettingsView canWrite={canAccess(me.permissions, "ads.write")} />;
}
