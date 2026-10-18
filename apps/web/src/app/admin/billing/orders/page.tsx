import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingOrdersView } from "../../../../components/admin/billing-orders-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.orders") };

export default async function AdminBillingOrdersPage() {
  const me = await requireMe("/admin/billing/orders");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingOrdersView canWrite={canAccess(me.permissions, "billing.write")} />;
}
