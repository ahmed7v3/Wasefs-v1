import { t } from "@wasfa/shared/i18n";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthFooter, AuthHeading } from "../../../components/auth/auth-heading";
import { LoginForm, type LoginBanner } from "../../../components/auth/login-form";
import { WhatsAppLogin } from "../../../components/auth/whatsapp-login";
import { JoinCookie } from "../../../components/join/join-cookie";
import { normalizeJoinSlug } from "../../../lib/attribution-cookies";
import { providersResponseSchema, type ProviderStates } from "../../../lib/auth-api";
import { getNonce } from "../../../lib/nonce";
import { safeNext } from "../../../lib/safe-next";
import { getMe, serverApi } from "../../../lib/session";
import { loadWhatsAppAvailable } from "../../../lib/whatsapp-availability";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: t("auth.login.title"),
  alternates: { canonical: "/login" },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A broken provider list must not take the password form down with it: no list, no social buttons. */
async function loadProviders(): Promise<ProviderStates> {
  try {
    return await serverApi("/auth/providers", { schema: providersResponseSchema });
  } catch {
    return [];
  }
}

// Better Auth appends `error=<CODE>` to the verification link's callback; the social callback uses
// the same parameter on /login.
const LINK_ERRORS = new Set(["INVALID_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND", "INVALID_USER"]);

function bannerFor(params: SearchParams): LoginBanner | undefined {
  const error = first(params["error"]);
  if (error) {
    if (LINK_ERRORS.has(error)) return "link_expired";
    return error === "provider_unavailable" ? "provider_unavailable" : "social_failed";
  }
  if (first(params["verified"]) === "1") return "verified";
  if (first(params["reset"]) === "1") return "reset";
  return undefined;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const next = safeNext(first(params["next"]));

  // Already signed in: the login page has nothing to offer. A failing session check just shows the form.
  if (await getMe().catch(() => null)) redirect(next);

  const [providers, nonce, whatsappAvailable] = await Promise.all([
    loadProviders(),
    getNonce(),
    loadWhatsAppAvailable(),
  ]);
  const joinSlug = normalizeJoinSlug(first(params["join"]));
  const registerParams = new URLSearchParams();
  if (next !== "/dashboard") registerParams.set("next", next);
  if (joinSlug) registerParams.set("join", joinSlug);
  const registerHref =
    registerParams.size > 0 ? `/register?${registerParams.toString()}` : "/register";

  return (
    <>
      {joinSlug ? <JoinCookie slug={joinSlug} /> : null}
      <AuthHeading title={t("auth.login.title")} lead={t("auth.login.lead")} />
      <WhatsAppLogin available={whatsappAvailable} next={next} nonce={nonce} />
      <LoginForm nonce={nonce} next={next} providers={providers} banner={bannerFor(params)} />
      <AuthFooter>
        {t("auth.login.noAccount")}{" "}
        <Link
          href={registerHref}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t("auth.login.createAccount")}
        </Link>
      </AuthFooter>
    </>
  );
}
