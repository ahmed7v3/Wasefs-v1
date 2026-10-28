import { t } from "@wasfa/shared/i18n";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { DrugReviewView } from "../../../../components/admin/drug-review-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.drugReview") };

export default async function AdminDrugReviewPage() {
  const me = await requireMe("/admin/drugs/review");
  if (!canAccess(me.permissions, "drugs.read")) return <ForbiddenState />;
  return <DrugReviewView canWrite={canAccess(me.permissions, "drugs.write")} />;
}
