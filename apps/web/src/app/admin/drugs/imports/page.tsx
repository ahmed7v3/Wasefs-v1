import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { DrugImportsView } from "../../../../components/admin/drug-imports-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.drugImports") };

export default async function AdminDrugImportsPage() {
  const me = await requireMe("/admin/drugs/imports");
  if (!canAccess(me.permissions, "drugs.read")) return <ForbiddenState />;
  return <DrugImportsView canWrite={canAccess(me.permissions, "drugs.write")} />;
}
