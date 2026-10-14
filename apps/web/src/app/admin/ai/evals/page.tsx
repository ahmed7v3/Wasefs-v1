import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { EvalsView } from "../../../../components/admin/evals-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.evals.title") };

export default async function AdminAiEvalsPage() {
  const me = await requireMe("/admin/ai/evals");
  if (!canAccess(me.permissions, "evals.run")) return <ForbiddenState />;
  return <EvalsView />;
}
