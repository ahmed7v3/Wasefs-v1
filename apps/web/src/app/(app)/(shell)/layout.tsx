import { ContactHub } from "../../../components/contact-hub";
import { JoinAcceptor } from "../../../components/join/join-acceptor";
import { AppShell } from "../../../components/shell/app-shell";
import { getPublicSettings } from "../../../lib/public-settings";
import { getRequestPath } from "../../../lib/request-path";
import { requireOnboarded } from "../../../lib/session";
import { requestedWorkspace } from "../../../lib/workspace-server";

import type { Metadata } from "next";
import type { ReactNode } from "react";

// The signed-in app is private: nothing here belongs in search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Frame of every signed-in page. The layout is the first gate (signed in and onboarded); each page
 * repeats the check with its own path, because Next does not re-render a layout on client navigation.
 */
export default async function ShellLayout({ children }: { children: ReactNode }) {
  const [me, settings] = await Promise.all([
    getRequestPath().then((path) => requireOnboarded(path)),
    getPublicSettings(),
  ]);
  const activeOrgId = await requestedWorkspace(me);
  return (
    <>
      <AppShell
        user={{
          name: me.name,
          image: me.image,
          organizations: me.organizations,
          activeOrgId,
        }}
        showAdmin={me.permissions.length > 0}
        branding={settings.branding}
      >
        {children}
      </AppShell>
      <JoinAcceptor
        verified={{ email: me.emailVerified && me.email !== null, phone: me.phoneVerified }}
      />
      <ContactHub contact={settings.contact} compact />
    </>
  );
}
