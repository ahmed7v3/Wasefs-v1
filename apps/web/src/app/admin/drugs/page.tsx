import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { DrugsView } from "../../../components/admin/drugs-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.drugs") };

export default async function AdminDrugsPage() {
  const me = await requireMe("/admin/drugs");
  if (!canAccess(me.permissions, "drugs.read")) return <ForbiddenState />;
  return <DrugsView canWrite={canAccess(me.permissions, "drugs.write")} />;
}
