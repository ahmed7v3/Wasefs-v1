import { t } from "@wasfa/shared/i18n";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthFooter, AuthHeading } from "../../../components/auth/auth-heading";
import { RegisterForm } from "../../../components/auth/register-form";
import { JoinCookie } from "../../../components/join/join-cookie";
import { normalizeJoinSlug, normalizeReferralCode } from "../../../lib/attribution-cookies";
import { providersResponseSchema, type ProviderStates } from "../../../lib/auth-api";
import { getNonce } from "../../../lib/nonce";
import { safeNext } from "../../../lib/safe-next";
import { getMe, serverApi } from "../../../lib/session";

import type { Metadata } from "next";

/** A broken provider list must not take the sign-up form down with it: no list, no social buttons. */
async function loadProviders(): Promise<ProviderStates> {
  try {
    return await serverApi("/auth/providers", { schema: providersResponseSchema });
  } catch {
    return [];
  }
}

export const metadata: Metadata = {
  title: t("auth.register.title"),
  alternates: { canonical: "/register" },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next, ref, join } = await searchParams;
  const target = safeNext(next);
  const joinSlug = normalizeJoinSlug(Array.isArray(join) ? join[0] : join);
  const referralCode = normalizeReferralCode(Array.isArray(ref) ? ref[0] : ref);

  if (await getMe().catch(() => null)) redirect(target);

  const [providers, nonce] = await Promise.all([loadProviders(), getNonce()]);
  const loginParams = new URLSearchParams();
  if (target !== "/dashboard") loginParams.set("next", target);
  if (joinSlug) loginParams.set("join", joinSlug);
  const loginHref = loginParams.size > 0 ? `/login?${loginParams.toString()}` : "/login";

  return (
    <>
      <AuthHeading title={t("auth.register.title")} lead={t("auth.register.lead")} />
      {joinSlug ? <JoinCookie slug={joinSlug} /> : null}
      <RegisterForm
        nonce={nonce}
        initialReferralCode={referralCode ?? ""}
        providers={providers}
        next={target}
      />
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
