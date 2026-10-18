import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { GrowthWithdrawalsView } from "../../../../components/admin/growth-withdrawals-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.withdrawals") };

export default async function AdminWithdrawalsPage() {
  const me = await requireMe("/admin/growth/withdrawals");
  if (!canAccess(me.permissions, "withdrawals.review")) return <ForbiddenState />;
  return (
    <Suspense>
      <GrowthWithdrawalsView
        canPay={canAccess(me.permissions, "withdrawals.pay")}
        canExport={canAccess(me.permissions, "finance.export")}
      />
    </Suspense>
  );
}
