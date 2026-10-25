import { CONTENT_LOCALES, CONTENT_TYPES } from "@wasfa/shared/content/constants";
import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";
import { z } from "zod";

import { ForbiddenState } from "../../../../components/admin/access-state";
import { ContentEditorView } from "../../../../components/admin/content-editor/content-editor-view";
import { canAccess } from "../../../../lib/admin-nav";
import { requireMe } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.editor.newTitle") };

const querySchema = z.object({
  type: z.enum(CONTENT_TYPES).catch("article"),
  locale: z.enum(CONTENT_LOCALES).catch("ar"),
  translationOf: z.uuid().optional().catch(undefined),
  duplicateOf: z.uuid().optional().catch(undefined),
});

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function AdminContentNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const query = querySchema.parse({
    type: first(raw["type"]),
    locale: first(raw["locale"]),
    translationOf: first(raw["translationOf"]),
    duplicateOf: first(raw["duplicateOf"]),
  });
  const me = await requireMe("/admin/content/new");
  if (!canAccess(me.permissions, "content.write")) return <ForbiddenState />;
  return (
    <Suspense>
      <ContentEditorView itemId={null} newItem={query} permissions={me.permissions} />
    </Suspense>
  );
}
