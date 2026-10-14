import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AiPlaygroundView } from "../../../../components/admin/ai-playground-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.ai.pg.title") };

export default async function AdminAiPlaygroundPage() {
  const me = await requireMe("/admin/ai/playground");
  if (!canAccess(me.permissions, "ai.write")) return <ForbiddenState />;
  return <AiPlaygroundView />;
}
