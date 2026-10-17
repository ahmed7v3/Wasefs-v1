import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { BillingCreditPacksView } from "../../../../components/admin/billing-credit-packs-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.creditPacks") };

export default async function AdminBillingCreditPacksPage() {
  const me = await requireMe("/admin/billing/credit-packs");
  if (!canAccess(me.permissions, "billing.read")) return <ForbiddenState />;
  return <BillingCreditPacksView canWrite={canAccess(me.permissions, "billing.write")} />;
}
