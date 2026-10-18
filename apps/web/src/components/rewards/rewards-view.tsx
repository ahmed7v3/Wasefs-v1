"use client";

import { t } from "@wasfa/shared/i18n";
import { meRewardsSchema } from "@wasfa/shared/schemas/rewards";
import { withdrawalEligibilitySchema } from "@wasfa/shared/schemas/withdrawals";
import { Skeleton } from "@wasfa/ui";
import { useCallback, useState } from "react";

import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ActivityList } from "./activity-list";
import { BalanceCard } from "./balance-card";
import { HowItWorks } from "./how-it-works";
import { InviteHero } from "./invite-hero";
import { ProgressCard } from "./progress-card";

/**
 * The «الدعوات والمكافآت» page. Eligibility for cash-out is read only to explain the disabled
 * withdraw button; if that call fails the page still works and says cash-out is not available yet.
 */
export function RewardsView() {
  const rewards = useResource("/me/rewards", meRewardsSchema);
  const eligibility = useResource("/me/withdrawals/eligibility", withdrawalEligibilitySchema);
  // Re-keys the activity list so it reloads after a conversion.
  const [version, setVersion] = useState(0);
  const { reload } = rewards;
  const { reload: reloadEligibility } = eligibility;
  const changed = useCallback(() => {
    reload();
    reloadEligibility();
    setVersion((current) => current + 1);
  }, [reload, reloadEligibility]);

  if (rewards.status === "loading") {
    return (
      <div role="status" aria-label={t("ui.loading")} className="flex flex-col gap-4">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (rewards.status === "error") {
    return <ErrorNotice error={rewards.error} onRetry={rewards.reload} />;
  }

  const { data } = rewards;
  const eligible = eligibility.status === "ready" ? eligibility.data : null;
  return (
    <div className="flex flex-col gap-6">
      {data.enabled ? null : <Notice tone="warning">{t("rewardsPage.disabled")}</Notice>}
      <InviteHero rewards={data} onRenamed={rewards.reload} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BalanceCard rewards={data} eligibility={eligible} onChanged={changed} />
        </div>
        <ProgressCard rewards={data} />
      </div>
      <ActivityList key={version} />
      <HowItWorks rewards={data} eligibility={eligible} />
    </div>
  );
}
