import { t } from "@wasfa/shared/i18n";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthFooter, AuthHeading } from "../../../components/auth/auth-heading";
import { RegisterForm } from "../../../components/auth/register-form";
import { getNonce } from "../../../lib/nonce";
import { safeNext } from "../../../lib/safe-next";
import { getMe } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: t("auth.register.title"),
  alternates: { canonical: "/register" },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next);

  if (await getMe().catch(() => null)) redirect(target);

  const nonce = await getNonce();
  const loginHref =
    target === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(target)}`;

  return (
    <>
      <AuthHeading title={t("auth.register.title")} lead={t("auth.register.lead")} />
      <RegisterForm nonce={nonce} />
      <AuthFooter>
        {t("auth.register.haveAccount")}{" "}
        <Link
          href={loginHref}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t("auth.register.signIn")}
        </Link>
      </AuthFooter>
    </>
  );
}
