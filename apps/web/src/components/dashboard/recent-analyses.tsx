"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { rxListResponseSchema } from "@wasfa/shared/schemas/rx";
import { Badge, buttonStyles, cn, EmptyState, Skeleton, type BadgeTone } from "@wasfa/ui";
import { FileScan } from "lucide-react";
import Link from "next/link";

import { formatRelative } from "../../lib/dates";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { DashboardPanel } from "./dashboard-panel";
import { RECENT_COUNT, RECENT_MIN_HEIGHT, RECENT_ROW } from "./recent-layout";

import type { RxStatus } from "@wasfa/shared/rx";

const STATUS: Record<RxStatus, { label: MessageKey; tone: BadgeTone }> = {
  queued: { label: "dashboard.rx.status.queued", tone: "neutral" },
  processing: { label: "dashboard.rx.status.processing", tone: "info" },
  verifying: { label: "dashboard.rx.status.verifying", tone: "info" },
  done: { label: "dashboard.rx.status.done", tone: "success" },
  failed: { label: "dashboard.rx.status.failed", tone: "danger" },
  refunded: { label: "dashboard.rx.status.refunded", tone: "warning" },
};

const PATH = `/rx?limit=${String(RECENT_COUNT)}`;

/** The five latest prescription analyses (`GET /rx`), each a link to its result. */
export function RecentAnalyses() {
  const list = useResource(PATH, rxListResponseSchema);

  return (
    <DashboardPanel
      id="recent-rx-title"
      title={t("dashboard.rx.title")}
      className={RECENT_MIN_HEIGHT}
      action={
        list.status === "ready" && list.data.items.length > 0 ? (
          <Link href="/analyze" className={buttonStyles({ variant: "ghost" })}>
            {t("dashboard.rx.start")}
          </Link>
        ) : undefined
      }
    >
      {list.status === "loading" ? (
        <div role="status" aria-label={t("ui.loading")} className="flex flex-col">
          {Array.from({ length: RECENT_COUNT }, (_, index) => (
            <div key={index} className={cn(RECENT_ROW, "flex-col justify-center gap-2")}>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ))}
        </div>
      ) : list.status === "error" ? (
        <ErrorNotice error={list.error} onRetry={list.reload} supportHref={null} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          titleAs="h3"
          icon={<FileScan />}
          title={t("dashboard.rx.empty")}
          description={t("dashboard.rx.emptyHint")}
          action={
            <Link href="/analyze" className={buttonStyles()}>
              {t("dashboard.rx.start")}
            </Link>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {list.data.items.slice(0, RECENT_COUNT).map((item) => {
            const summary =
              item.itemNames.length > 0 ? item.itemNames.join("، ") : t("dashboard.rx.noItems");
            const status = STATUS[item.status];
            return (
              <li key={item.id}>
                <Link
                  href={`/analyze/${item.id}`}
                  className={cn(
                    RECENT_ROW,
                    "items-center justify-between gap-3 rounded-md px-2 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus",
                  )}
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <bdi className="truncate text-base font-semibold text-text">{summary}</bdi>
                    <span className="truncate text-sm text-text-muted">
                      {t("dashboard.rx.items", { count: item.itemCount })} ·{" "}
                      {formatRelative(item.createdAt)}
                    </span>
                  </span>
                  <Badge tone={status.tone} className="shrink-0">
                    {t(status.label)}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}
