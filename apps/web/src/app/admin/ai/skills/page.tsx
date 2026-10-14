import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { AiSkillsView } from "../../../../components/admin/ai-skills-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.ai.skills.title") };

export default async function AdminAiSkillsPage() {
  const me = await requireMe("/admin/ai/skills");
  if (!canAccess(me.permissions, "ai.read")) return <ForbiddenState />;
  return <AiSkillsView canWrite={canAccess(me.permissions, "ai.write")} />;
}
