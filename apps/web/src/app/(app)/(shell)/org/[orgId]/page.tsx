import { t } from "@wasfa/shared/i18n";
import { orgContextIdSchema } from "@wasfa/shared/schemas/org";
import { notFound } from "next/navigation";

import { OrgDashboard } from "../../../../../components/org/org-dashboard";
import { getCatalog } from "../../../../../lib/billing-server";
import { requireOnboarded } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("org.title") };

/**
 * Admin console of one organization. The page only gates on sign-in and loads plan names; who may
 * see the numbers is decided by the API (`org_admin`), and a refusal renders as a calm message.
 */
export default async function OrgPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  await requireOnboarded(`/org/${orgId}`);
  const parsed = orgContextIdSchema.safeParse(orgId);
  if (!parsed.success) notFound();

  const catalog = await getCatalog(undefined);
  const names: Record<string, string> = {};
  for (const plan of catalog?.plans ?? []) names[plan.key] = plan.names.ar;
  for (const pack of catalog?.creditPacks ?? []) names[pack.key] = pack.names.ar;

  return <OrgDashboard orgId={parsed.data} names={names} />;
}
