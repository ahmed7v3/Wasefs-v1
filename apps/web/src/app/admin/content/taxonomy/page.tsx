import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { ContentTaxonomyView } from "../../../../components/admin/content-taxonomy-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.taxonomy") };

export default async function AdminContentTaxonomyPage() {
  const me = await requireMe("/admin/content/taxonomy");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentTaxonomyView permissions={me.permissions} />
    </Suspense>
  );
}
