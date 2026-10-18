import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingGatewaysView } from "../../../../components/admin/billing-gateways-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.billing.gateways.title") };

export default async function AdminBillingGatewaysPage() {
  const me = await requireMe("/admin/billing/gateways");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingGatewaysView canWrite={canAccess(me.permissions, "billing.write")} />;
}
