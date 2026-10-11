import { t } from "@wasfa/shared/i18n";
import { ANONYMIZED_USER_NAME } from "@wasfa/shared/identity";

import { MyInvites } from "../../../../components/dashboard/my-invites";
import { ToolCards } from "../../../../components/dashboard/tool-cards";
import { VerificationBanner } from "../../../../components/dashboard/verification-banner";
import { displayName } from "../../../../lib/labels";
import { getNonce } from "../../../../lib/nonce";
import { requireOnboarded } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("dashboard.title") };

export default async function DashboardPage() {
  const me = await requireOnboarded("/dashboard");
  const firstName = displayName(me.name, ANONYMIZED_USER_NAME).trim().split(/\s+/)[0] ?? "";
  const nonce = me.canUseTools ? undefined : await getNonce();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("dashboard.greeting", { name: firstName })}
        </h1>
        <p className="text-lg text-text-muted">{t("dashboard.lead")}</p>
      </header>
      {me.canUseTools ? null : <VerificationBanner me={me} nonce={nonce} />}
      <MyInvites />
      <ToolCards />
      <p className="text-sm text-text-muted">{t("home.disclaimer")}</p>
    </div>
  );
}
