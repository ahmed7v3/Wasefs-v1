import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { EarlyAccessView } from "../../../../components/admin/early-access/early-access-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.earlyAccess") };

export default async function AdminEarlyAccessPage() {
  const me = await requireMe("/admin/growth/early-access");
  if (!canAccess(me.permissions, "users.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <EarlyAccessView canWriteSettings={canAccess(me.permissions, "settings.write")} />
    </Suspense>
  );
}
