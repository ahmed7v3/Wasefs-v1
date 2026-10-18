import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingPaymentsView } from "../../../../components/admin/billing-payments-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.payments") };

export default async function AdminBillingPaymentsPage() {
  const me = await requireMe("/admin/billing/payments");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingPaymentsView canReview={canAccess(me.permissions, "payments.review")} canRefund={canAccess(me.permissions, "payments.refund")} />;
}
