import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { AiOverviewPanel } from "../../../components/admin/ai-overview-panel";
import { AiSettingsView } from "../../../components/admin/ai-settings-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.ai") };

export default async function AdminAiSettingsPage() {
  const me = await requireMe("/admin/ai");
  if (!canAccess(me.permissions, "ai.read")) return <ForbiddenState />;
  return (
    <div className="flex flex-col gap-8">
      {canAccess(me.permissions, "usage.read") ? <AiOverviewPanel /> : null}
      <AiSettingsView
        canWrite={canAccess(me.permissions, "ai.write")}
        canKill={canAccess(me.permissions, "ai.killswitch")}
      />
    </div>
  );
}
