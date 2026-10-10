import { t } from "@wasfa/shared/i18n";

import { AuthHeading } from "../../../components/auth/auth-heading";
import { ForgotPasswordForm } from "../../../components/auth/forgot-password-form";
import { getNonce } from "../../../lib/nonce";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("auth.forgot.title") };

export default async function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title={t("auth.forgot.title")} lead={t("auth.forgot.lead")} />
      <ForgotPasswordForm nonce={await getNonce()} />
    </>
  );
}
