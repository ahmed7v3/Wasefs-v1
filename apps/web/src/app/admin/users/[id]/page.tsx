import { t } from "@wasfa/shared/i18n";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { User360View } from "../../../../components/admin/user-360-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.user360.title") };

const idSchema = z.uuid();

export default async function AdminUser360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();
  const me = await requireMe(`/admin/users/${parsed.data}`);
  if (!canAccess(me.permissions, "users.read")) return <ForbiddenState />;
  return <User360View userId={parsed.data} permissions={me.permissions} />;
}
