import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingRefundsView } from "../../../../components/admin/billing-refunds-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.refunds") };

export default async function AdminBillingRefundsPage() {
  const me = await requireMe("/admin/billing/refunds");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingRefundsView />;
}
