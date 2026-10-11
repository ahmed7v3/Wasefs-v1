import { t } from "@wasfa/shared/i18n";
import { ISSUE_FINGERPRINT_PATTERN } from "@wasfa/shared/schemas/admin";
import { notFound } from "next/navigation";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { IssueDetail } from "../../../../components/admin/issue-detail";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.issues") };

export default async function AdminIssuePage({
  params,
}: {
  params: Promise<{ fingerprint: string }>;
}) {
  const { fingerprint } = await params;
  // A malformed id can never be a fingerprint: no API round trip for it.
  if (!ISSUE_FINGERPRINT_PATTERN.test(fingerprint)) notFound();
  const me = await requireMe(`/admin/issues/${fingerprint}`);
  if (!canAccess(me.permissions, "issues.read")) return <ForbiddenState />;
  return (
    <IssueDetail
      fingerprint={fingerprint}
      canWrite={canAccess(me.permissions, "issues.write")}
      canReadUsers={canAccess(me.permissions, "users.read")}
    />
  );
}
