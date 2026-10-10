import { t } from "@wasfa/shared/i18n";

import { AuthHeading } from "../../../components/auth/auth-heading";
import { VerifyEmailPanel } from "../../../components/auth/verify-email-panel";
import { getNonce } from "../../../lib/nonce";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("auth.verify.title") };

export default async function VerifyEmailPage() {
  return (
    <>
      <AuthHeading title={t("auth.verify.title")} />
      <VerifyEmailPanel nonce={await getNonce()} />
    </>
  );
}
