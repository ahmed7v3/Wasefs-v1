import { t } from "@wasfa/shared/i18n";
import { buttonStyles } from "@wasfa/ui";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { AuthHeading } from "../../../components/auth/auth-heading";
import { ResetPasswordForm } from "../../../components/auth/reset-password-form";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: t("auth.reset.title"),
  // The one-time token is in the URL: keep it out of any referrer.
  referrer: "no-referrer",
};

/**
 * The API redirects the emailed link here as `?token=<one-time token>`, or `?error=INVALID_TOKEN`
 * when the link was used or has expired.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;
  const value = Array.isArray(token) ? token[0] : token;

  if (error || !value) {
    return (
      <>
        <AuthHeading title={t("auth.reset.invalidTitle")} />
        <div className="flex flex-col items-center gap-5 text-center" role="alert">
          <TriangleAlert aria-hidden className="size-12 text-danger" />
          <p className="text-lg text-text">{t("auth.reset.invalidBody")}</p>
          <Link href="/forgot-password" className={buttonStyles()}>
            {t("auth.reset.requestNew")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading title={t("auth.reset.title")} lead={t("auth.reset.lead")} />
      <ResetPasswordForm token={value} />
    </>
  );
}
