import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AiModelsView } from "../../../../components/admin/ai-models-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.aiModels") };

export default async function AdminAiModelsPage() {
  const me = await requireMe("/admin/ai/models");
  if (!canAccess(me.permissions, "ai.read")) return <ForbiddenState />;
  return <AiModelsView canWrite={canAccess(me.permissions, "ai.write")} />;
}
