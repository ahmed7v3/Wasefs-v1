import { t } from "@wasfa/shared/i18n";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { ContentEditorView } from "../../../../components/admin/content-editor/content-editor-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.editor.title") };

const idSchema = z.uuid();

export default async function AdminContentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();
  const me = await requireMe(`/admin/content/${parsed.data}`);
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentEditorView itemId={parsed.data} permissions={me.permissions} />
    </Suspense>
  );
}
