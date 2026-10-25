import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { ForbiddenState } from "../../../components/admin/access-state";
import { MediaLibraryView } from "../../../components/admin/media-library-view";
import { canAccess } from "../../../lib/admin-nav";
import { requireMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("admin.nav.content.media") };

export default async function AdminMediaPage() {
  const me = await requireMe("/admin/media");
  if (!canAccess(me.permissions, "content.read")) return <ForbiddenState />;
  return (
    <Suspense>
      <MediaLibraryView permissions={me.permissions} />
    </Suspense>
  );
}
