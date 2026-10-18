import { t } from "@wasfa/shared/i18n";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { WithdrawView } from "../../../../../components/rewards/withdraw-view";
import { ReauthProvider } from "../../../../../lib/reauth";
import { requireOnboarded } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("withdrawPage.title") };

/** Requesting a withdrawal needs a fresh sign-in, so the page carries the "confirm it is you" dialog. */
export default async function WithdrawPage() {
  await requireOnboarded("/rewards/withdraw");
  return (
    <ReauthProvider>
      <div className="flex flex-col gap-6">
        <Link href="/rewards" className="inline-flex items-center gap-2 text-base text-primary underline-offset-4 hover:underline">
          <ArrowRight aria-hidden className="size-4 ltr:-scale-x-100" />
          {t("withdrawPage.back")}
        </Link>
        <header className="flex flex-col gap-2">
          <h1 className="font-heading text-2xl font-bold text-primary sm:text-4xl">
            {t("withdrawPage.title")}
          </h1>
          <p className="text-base text-text-muted sm:text-lg">{t("withdrawPage.lead")}</p>
        </header>
        <WithdrawView />
      </div>
    </ReauthProvider>
  );
}
