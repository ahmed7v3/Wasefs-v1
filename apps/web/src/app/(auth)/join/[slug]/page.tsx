import { t } from "@wasfa/shared/i18n";
import { buttonStyles } from "@wasfa/ui";
import { Building2, Gift } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { AuthHeading } from "../../../../components/auth/auth-heading";
import { JoinCookie } from "../../../../components/join/join-cookie";
import { Notice } from "../../../../components/notice";
import { normalizeJoinSlug } from "../../../../lib/attribution-cookies";
import { getJoinLanding } from "../../../../lib/join-server";
import { getMe } from "../../../../lib/session";

import type { Metadata } from "next";

// A join link is for the people it was sent to, not for search results (the auth layout also says so).
export const metadata: Metadata = { title: t("join.title") };

/** One calm message for every link that cannot be used: nothing tells a typo from a disabled link. */
function InvalidLink() {
  return (
    <>
      <AuthHeading title={t("join.invalid.title")} />
      <div className="flex flex-col gap-4">
        <p className="text-base text-text">{t("join.invalid")}</p>
        <p className="text-base text-text-muted">{t("join.invalid.hint")}</p>
        <Link href="/" className={buttonStyles({ variant: "secondary" })}>
          {t("common.backHome")}
        </Link>
      </div>
    </>
  );
}

/**
 * `/join/<slug>`: the landing page of an organization's join link, rendered on the server. The slug
 * is kept in a cookie for 7 days so the sign-up, verification and onboarding detour still ends with
 * the person joining (the signed-in shell finishes it).
 */
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = normalizeJoinSlug((await params).slug);
  const landing = slug === null ? null : await getJoinLanding(slug);
  if (slug === null || !landing?.valid) return <InvalidLink />;

  const signedIn = (await getMe().catch(() => null)) !== null;
  const query = `?join=${encodeURIComponent(slug)}`;
  const benefit = landing.benefit;

  return (
    <>
      <JoinCookie slug={slug} />
      <AuthHeading title={t("join.heading", { org: landing.org.name })} lead={t("join.lead")} />
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-lg bg-primary-soft p-4">
          {landing.org.logoUrl ? (
            <Image
              unoptimized
              src={landing.org.logoUrl}
              alt=""
              width={48}
              height={48}
              className="size-12 rounded-md object-contain"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-md bg-surface text-primary"
            >
              <Building2 className="size-6" />
            </span>
          )}
          <p className="font-heading text-xl font-bold text-text">{landing.org.name}</p>
        </div>

        {benefit?.dealName || benefit?.memberPriceText ? (
          <div className="flex items-start gap-3">
            <Gift aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-text-muted">{t("join.benefit")}</p>
              {benefit.dealName ? (
                <p className="text-base font-semibold text-text">{benefit.dealName}</p>
              ) : null}
              {benefit.memberPriceText ? (
                <p className="text-base text-text">{benefit.memberPriceText}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {landing.approval === "requires_approval" ? (
          <Notice>{t("join.needsApproval")}</Notice>
        ) : null}

        {signedIn ? (
          <Link href="/dashboard" className={buttonStyles({ size: "lg" })}>
            {t("join.continue")}
          </Link>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={`/register${query}`}
              className={buttonStyles({ size: "lg", className: "flex-1" })}
            >
              {t("join.register")}
            </Link>
            <Link
              href={`/login${query}`}
              className={buttonStyles({ variant: "secondary", size: "lg", className: "flex-1" })}
            >
              {t("join.signIn")}
            </Link>
          </div>
        )}
        <p className="text-sm text-text-muted">{t("join.verifyNote")}</p>
      </div>
    </>
  );
}
