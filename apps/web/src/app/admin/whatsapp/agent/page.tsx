import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { WaAgentView } from "../../../../components/admin/wa-agent-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.waAgent") };

export default async function AdminWaAgentPage() {
  const me = await requireMe("/admin/whatsapp/agent");
  if (!canAccess(me.permissions, "wa_agent.read")) return <ForbiddenState />;
  return (
    <WaAgentView
      canWrite={canAccess(me.permissions, "wa_agent.write")}
      canInbox={canAccess(me.permissions, "wa_agent.inbox")}
      canReadPlans={canAccess(me.permissions, "plans.read")}
    />
  );
}
