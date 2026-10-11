import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { UsersView } from "../../../components/admin/users-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.users") };

export default async function AdminUsersPage() {
  const me = await requireMe("/admin/users");
  if (!canAccess(me.permissions, "users.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <UsersView meId={me.id} permissions={me.permissions} />
    </Suspense>
  );
}
