import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../components/admin/access-state";
import { BillingOverviewView } from "../../../components/admin/billing-overview-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.billingOverview") };

export default async function AdminBillingOverviewPage() {
  const me = await requireMe("/admin/billing");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingOverviewView />;
}
