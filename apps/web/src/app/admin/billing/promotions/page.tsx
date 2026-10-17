import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingPromotionsView } from "../../../../components/admin/billing-promotions-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.promotions") };

export default async function AdminBillingPromotionsPage() {
  const me = await requireMe("/admin/billing/promotions");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingPromotionsView canWrite={canAccess(me.permissions, "promotions.write")} />;
}
