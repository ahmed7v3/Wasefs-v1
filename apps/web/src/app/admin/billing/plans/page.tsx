import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingPlansView } from "../../../../components/admin/billing-plans-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.pricingPlans") };

export default async function AdminBillingPlansPage() {
  const me = await requireMe("/admin/billing/plans");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingPlansView
      canPublish={canAccess(me.permissions, "billing.write")}
      canEditPlan={canAccess(me.permissions, "plans.write")}
      canReadAllowances={canAccess(me.permissions, "plans.read")}
     />;
}
