import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { ContentCalendarView } from "../../../../components/admin/content-calendar-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.calendar") };

export default async function AdminContentCalendarPage() {
  const me = await requireMe("/admin/content/calendar");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentCalendarView />
    </Suspense>
  );
}
