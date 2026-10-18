import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingSubscriptionsView } from "../../../../components/admin/billing-subscriptions-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.subscriptions") };

export default async function AdminBillingSubscriptionsPage() {
  const me = await requireMe("/admin/billing/subscriptions");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingSubscriptionsView canManage={canAccess(me.permissions, "users.upgrade")} />;
}
