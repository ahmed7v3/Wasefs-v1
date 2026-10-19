import { t } from "@wasfa/shared/i18n";
import { ANONYMIZED_USER_NAME } from "@wasfa/shared/identity";

import { CreditsCard } from "../../../../components/dashboard/credits-card";
import { MyInvites } from "../../../../components/dashboard/my-invites";
import { PlanEndingBanner } from "../../../../components/dashboard/plan-ending-banner";
import { QuickCapture } from "../../../../components/dashboard/quick-capture";
import { RecentAnalyses } from "../../../../components/dashboard/recent-analyses";
import { RecentChats } from "../../../../components/dashboard/recent-chats";
import { ToolCards } from "../../../../components/dashboard/tool-cards";
import { VerificationBanner } from "../../../../components/dashboard/verification-banner";
import { OffersCard } from "../../../../components/growth/offers-card";
import { PromptSlot } from "../../../../components/growth/prompt-slot";
import { ValueLedger } from "../../../../components/growth/value-ledger";
import { displayName } from "../../../../lib/labels";
import { getNonce } from "../../../../lib/nonce";
import { getPublicSettings } from "../../../../lib/public-settings";
import { requireOnboarded } from "../../../../lib/session";
import { requestedWorkspace } from "../../../../lib/workspace-server";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("dashboard.title") };

export default async function DashboardPage() {
  const me = await requireOnboarded("/dashboard");
  const firstName = displayName(me.name, ANONYMIZED_USER_NAME).trim().split(/\s+/)[0] ?? "";
  const nonce = me.canUseTools ? undefined : await getNonce();
  const orgId = await requestedWorkspace(me);
  const settings = me.canUseTools ? await getPublicSettings() : null;

  return (
    <div className="flex flex-col gap-5 sm:gap-8">
      <header className="flex flex-col gap-2 sm:gap-3">
        <h1 className="font-heading text-2xl font-bold leading-snug text-primary sm:text-4xl">
          {t("dashboard.greeting", { name: firstName })}
        </h1>
        <p className="text-base text-text-muted sm:text-lg">{t("dashboard.lead")}</p>
      </header>
      {me.canUseTools ? null : <VerificationBanner me={me} nonce={nonce} />}
      {settings ? <PlanEndingBanner /> : null}
      <MyInvites />
      {settings ? (
        <>
          {/* Capture beside the wallet (the reference's stat row), then the recent work in two columns. */}
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <QuickCapture maxPages={settings.rx.maxPages} />
            </div>
            <CreditsCard orgId={orgId} />
          </div>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
            <RecentAnalyses />
            <RecentChats />
          </div>
        </>
      ) : null}
      <ToolCards />
      {/* Loaded in the browser and often empty: below the work, so their arrival moves nothing above. */}
      {settings ? (
        <>
          <ValueLedger />
          <OffersCard />
          <PromptSlot context="dashboard" orgId={orgId ?? undefined} />
        </>
      ) : null}
      <p className="text-sm text-text-muted">{t("home.disclaimer")}</p>
    </div>
  );
}
