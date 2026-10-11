import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { OrgsView } from "../../../components/admin/orgs-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.orgs") };

export default async function AdminOrgsPage() {
  const me = await requireMe("/admin/orgs");
  if (!canAccess(me.permissions, "orgs.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <OrgsView />
    </Suspense>
  );
}
