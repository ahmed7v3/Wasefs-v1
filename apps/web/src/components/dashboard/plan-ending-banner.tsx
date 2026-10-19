"use client";

import { t } from "@wasfa/shared/i18n";
import { mySubscriptionResponseSchema } from "@wasfa/shared/schemas/subscriptions";
import Link from "next/link";

import { formatDate } from "../../lib/dates";
import { useResource } from "../../lib/use-admin-data";
import { planTimeline } from "../billing/plan-details";
import { Notice } from "../notice";

/**
 * A reminder on the dashboard in the last days of a subscription (or during grace), with the way
 * to renew. Renders nothing otherwise, and nothing while loading or on error: it is a hint only.
 */
export function PlanEndingBanner() {
  const mine = useResource("/me/subscription", mySubscriptionResponseSchema);
  if (mine.status !== "ready") return null;
  const subscription = mine.data.subscription;
  if (!subscription || subscription.cancelAtPeriodEnd) return null;
  const timeline = planTimeline(subscription, new Date());
  if (!timeline.endingSoon) return null;
  return (
    <Notice tone="warning">
      {t("dashboard.planEnding", {
        plan: subscription.plan.nameAr,
        days: timeline.daysLeft,
        date: formatDate(timeline.endsAt),
      })}{" "}
      <Link
        href={subscription.status === "trialing" ? "/pricing" : "/billing/renew"}
        className="font-semibold text-primary underline"
      >
        {subscription.status === "trialing"
          ? t("dashboard.planEnding.choose")
          : t("dashboard.planEnding.renew")}
      </Link>
    </Notice>
  );
}
