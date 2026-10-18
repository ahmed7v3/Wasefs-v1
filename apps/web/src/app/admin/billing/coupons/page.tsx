import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingCouponsView } from "../../../../components/admin/billing-coupons-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.coupons") };

export default async function AdminBillingCouponsPage() {
  const me = await requireMe("/admin/billing/coupons");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingCouponsView canWrite={canAccess(me.permissions, "coupons.write")} />;
}
