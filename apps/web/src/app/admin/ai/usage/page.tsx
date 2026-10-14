import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AiUsageView } from "../../../../components/admin/ai-usage-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.ai.usage.title") };

export default async function AdminAiUsagePage() {
  const me = await requireMe("/admin/ai/usage");
  if (!canAccess(me.permissions, "usage.read")) return <ForbiddenState />;
  return <AiUsageView />;
}
