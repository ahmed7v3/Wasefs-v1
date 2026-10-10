import { t } from "@wasfa/shared/i18n";

import { AuthHeading } from "../../../../components/auth/auth-heading";
import { TwoFactorForm } from "../../../../components/auth/two-factor-form";
import { safeNext } from "../../../../lib/safe-next";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("auth.twoFactor.title") };

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return (
    <>
      <AuthHeading title={t("auth.twoFactor.title")} lead={t("auth.twoFactor.lead")} />
      <TwoFactorForm next={safeNext(next)} />
    </>
  );
}
