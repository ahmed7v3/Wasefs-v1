import { t } from "@wasfa/shared/i18n";

import { AuthHeading } from "../../../../../components/auth/auth-heading";
import { WhatsAppMagicLink } from "../../../../../components/auth/whatsapp-magic-link";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: t("auth.whatsapp.link.title"),
  // The token lives in the URL fragment, which is never sent anywhere; still, no referrer at all.
  referrer: "no-referrer",
};

/** The agent's one-time sign-in link. The token is read from the fragment in the browser only. */
export default function WhatsAppLinkPage() {
  return (
    <>
      <AuthHeading title={t("auth.whatsapp.link.title")} />
      <WhatsAppMagicLink />
    </>
  );
}
