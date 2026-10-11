import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { WhatsappView } from "../../../components/admin/whatsapp-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.whatsapp") };

export default async function AdminWhatsappPage() {
  const me = await requireMe("/admin/whatsapp");
  if (!canAccess(me.permissions, "settings.read")) return <ForbiddenState />;
  return <WhatsappView canWrite={canAccess(me.permissions, "settings.write")} />;
}
