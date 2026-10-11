import { t } from "@wasfa/shared/i18n";

import { AuthHeading } from "../../../components/auth/auth-heading";
import { InviteAccept } from "../../../components/invite/invite-accept";

import type { Metadata } from "next";

// The token is in the URL fragment, so this page is deliberately not behind the login redirect:
// a redirect would drop the fragment. The component asks `/me` itself.
export const metadata: Metadata = { title: t("invite.title") };

export default function InvitePage() {
  return (
    <>
      <AuthHeading title={t("invite.title")} />
      <InviteAccept />
    </>
  );
}
