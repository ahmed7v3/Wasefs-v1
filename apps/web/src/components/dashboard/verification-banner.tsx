import { t } from "@wasfa/shared/i18n";
import { buttonStyles } from "@wasfa/ui";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { ResendVerification } from "../auth/resend-verification";

import type { MeResponse } from "@wasfa/shared/schemas/user";

export interface VerificationBannerProps {
  me: Pick<MeResponse, "email" | "emailVerified" | "phoneVerified">;
  nonce: string | undefined;
}

/**
 * Shown while `canUseTools` is false (neither the email nor the phone is verified): says what is
 * missing and offers the way out for each, so the dashboard never just refuses.
 */
export function VerificationBanner({ me, nonce }: VerificationBannerProps) {
  const emailPending = me.email !== null && !me.emailVerified;
  return (
    <section
      aria-labelledby="verify-banner-title"
      className="flex flex-col gap-4 rounded-xl border border-warning/30 bg-warning-soft p-5"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert aria-hidden className="mt-1 size-6 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <h2 id="verify-banner-title" className="font-heading text-xl font-semibold text-text">
            {t("dashboard.verify.title")}
          </h2>
          <p className="text-base text-text">{t("dashboard.verify.body")}</p>
        </div>
      </div>
      {emailPending && me.email ? (
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-4">
          <p className="text-base text-text">
            {t("dashboard.verify.email", { email: "⁦" + me.email + "⁩" })}
          </p>
          <ResendVerification email={me.email} nonce={nonce} />
        </div>
      ) : null}
      {!me.phoneVerified ? (
        <div>
          <Link href="/account#phone" className={buttonStyles({ variant: "secondary" })}>
            {t("dashboard.verify.phoneLink")}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
