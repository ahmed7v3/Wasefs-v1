import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { DrugRecognitionView } from "../../../../components/admin/drug-recognition-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.drugRecognition") };

export default async function AdminDrugRecognitionPage() {
  const me = await requireMe("/admin/drugs/recognition");
  if (!canAccess(me.permissions, "drugs.read")) return <ForbiddenState />;
  return (
    <DrugRecognitionView
      canReadSettings={canAccess(me.permissions, "settings.read")}
      canWriteSettings={canAccess(me.permissions, "settings.write")}
    />
  );
}
