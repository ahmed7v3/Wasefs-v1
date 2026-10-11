import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { FlagsView } from "../../../components/admin/flags-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.flags") };

export default async function AdminFlagsPage() {
  const me = await requireMe("/admin/flags");
  if (!canAccess(me.permissions, "flags.read")) return <ForbiddenState />;
  return <FlagsView canWrite={canAccess(me.permissions, "flags.write")} />;
}
