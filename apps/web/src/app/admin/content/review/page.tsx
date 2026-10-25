import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { ContentReviewView } from "../../../../components/admin/content-review-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.review") };

export default async function AdminContentReviewPage() {
  const me = await requireMe("/admin/content/review");
  if (!canAccess(me.permissions, "content.review")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentReviewView />
    </Suspense>
  );
}
