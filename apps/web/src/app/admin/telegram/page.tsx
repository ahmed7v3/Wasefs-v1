import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { TelegramView } from "../../../components/admin/telegram-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.telegram") };

export default async function AdminTelegramPage() {
  const me = await requireMe("/admin/telegram");
  if (!canAccess(me.permissions, "wa_agent.read")) return <ForbiddenState />;
  return <TelegramView canWrite={canAccess(me.permissions, "wa_agent.write")} />;
}
