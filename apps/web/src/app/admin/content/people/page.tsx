import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { ContentPeopleView } from "../../../../components/admin/content-people-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.people") };

export default async function AdminContentPeoplePage() {
  const me = await requireMe("/admin/content/people");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentPeopleView permissions={me.permissions} />
    </Suspense>
  );
}
