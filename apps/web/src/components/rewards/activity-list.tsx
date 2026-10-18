"use client";

import { t } from "@wasfa/shared/i18n";
import { rewardActivityPageSchema } from "@wasfa/shared/schemas/rewards";
import { Badge, Button, EmptyState, Skeleton, cn } from "@wasfa/ui";
import { History } from "lucide-react";

import { formatDate } from "../../lib/dates";
import { activityLines, signedPoints } from "../../lib/rewards-text";
import { useCursorList } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

/** Block 4 of REFERRALS §10: every movement of points in plain Arabic, newest first, initials only. The parent re-keys it to reload. */
export function ActivityList() {
  const list = useCursorList("/me/rewards/activity", "", rewardActivityPageSchema);

  return (
    <section aria-labelledby="activity-title" className="flex flex-col gap-3">
      <h2 id="activity-title" className="font-heading text-xl font-bold text-text">
        {t("rewardsPage.activity.title")}
      </h2>
      {list.status === "loading" ? (
        <Skeleton className="h-32 w-full" />
      ) : list.status === "error" ? (
        <ErrorNotice error={list.error} onRetry={list.reload} supportHref={null} />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t("rewardsPage.activity.empty")}
          description={t("rewardsPage.activity.emptyHint")}
          titleAs="h3"
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border/60 rounded-xl border border-border/60 bg-surface">
            {list.items.map((entry) => {
              const { title, detail } = activityLines(entry);
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4"
                  data-testid="activity-entry"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-base font-semibold text-text">{title}</span>
                    {detail ? <span className="text-sm text-text-muted">{detail}</span> : null}
                    <span className="text-sm text-text-muted">
                      {formatDate(entry.createdAt)}
                      {entry.releaseAt
                        ? ` · ${t("rewardsPage.activity.releaseAt", { date: formatDate(entry.releaseAt) })}`
                        : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{t(`rewardsPage.bucket.${entry.bucket}`)}</Badge>
                    <span
                      className={cn(
                        "text-base font-semibold tabular-nums",
                        entry.amount < 0 ? "text-danger" : "text-success",
                      )}
                    >
                      <bdi>{signedPoints(entry.amount)}</bdi>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
          {list.loadMoreError ? (
            <ErrorNotice error={list.loadMoreError} supportHref={null} />
          ) : null}
          {list.nextCursor ? (
            <Button
              variant="secondary"
              className="self-center"
              loading={list.loadingMore}
              onClick={list.loadMore}
            >
              {t("rewardsPage.activity.more")}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
