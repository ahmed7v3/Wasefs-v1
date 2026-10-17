import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingMethodsView } from "../../../../components/admin/billing-methods-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.paymentMethods") };

export default async function AdminBillingMethodsPage() {
  const me = await requireMe("/admin/billing/methods");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingMethodsView canWrite={canAccess(me.permissions, "billing.write")} />;
}
