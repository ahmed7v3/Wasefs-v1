import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AiProvidersView } from "../../../../components/admin/ai-providers-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.aiProviders") };

export default async function AdminAiProvidersPage() {
  const me = await requireMe("/admin/ai/providers");
  if (!canAccess(me.permissions, "ai.read")) return <ForbiddenState />;
  return <AiProvidersView canWrite={canAccess(me.permissions, "ai.write")} />;
}
