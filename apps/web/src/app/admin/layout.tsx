import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";

import { AdminAccessState } from "../../components/admin/access-state";
import { AdminShell } from "../../components/admin/admin-shell";
import { probeAdminAccess } from "../../lib/admin-server";
import { getPublicSettings } from "../../lib/public-settings";
import { ReauthProvider } from "../../lib/reauth";
import { getRequestPath } from "../../lib/request-path";
import { requireMe } from "../../lib/session";

import "../../styles/admin.css";

import type { Metadata } from "next";
import type { ReactNode } from "react";

// The admin area is private and never belongs in search results.
export const metadata: Metadata = {
  title: { default: t("admin.title"), template: `%s | ${t("admin.title")}` },
  robots: { index: false, follow: false },
};

/**
 * Frame of every admin page. First gate: signed in, holds at least one permission, and the API
 * accepts the session for admin routes (second factor). Each page repeats its own permission check:
 * Next does not re-render a layout on client navigation, and the API stays the authority anyway.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await requireMe(await getRequestPath());
  if (me.permissions.length === 0) return <AdminAccessState reason="forbidden" />;

  const access = await probeAdminAccess(me);
  if (access !== "ok") return <AdminAccessState reason={access} />;

  const { branding } = await getPublicSettings();

  return (
    <ToastProvider>
      <ReauthProvider>
        <AdminShell
          user={{ name: me.name, image: me.image }}
          permissions={me.permissions}
          branding={branding}
        >
          {children}
        </AdminShell>
      </ReauthProvider>
    </ToastProvider>
  );
}
