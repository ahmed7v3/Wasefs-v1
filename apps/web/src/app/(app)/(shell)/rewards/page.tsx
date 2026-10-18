import { t } from "@wasfa/shared/i18n";

import { RewardsView } from "../../../../components/rewards/rewards-view";
import { requireOnboarded } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("rewardsPage.title") };

export default async function RewardsPage() {
  await requireOnboarded("/rewards");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold text-primary sm:text-4xl">
          {t("rewardsPage.title")}
        </h1>
        <p className="text-base text-text-muted sm:text-lg">{t("rewardsPage.lead")}</p>
      </header>
      <RewardsView />
    </div>
  );
}
