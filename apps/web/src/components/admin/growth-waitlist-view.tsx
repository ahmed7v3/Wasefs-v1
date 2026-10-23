"use client";

import { t } from "@wasfa/shared/i18n";
import {
  adminAppWaitlistResponseSchema,
  type AdminAppWaitlistResponse,
} from "@wasfa/shared/schemas/public-site";
import { Button, useToast } from "@wasfa/ui";
import { Download } from "lucide-react";

import { formatNumber, formatShortDate } from "../../lib/admin-format";
import { downloadCsv } from "../../lib/csv-download";
import { useCursorList, useResource } from "../../lib/use-admin-data";

import { DataTable, type DataTableColumn } from "./data-table";

type Entry = AdminAppWaitlistResponse["items"][number];

const PLATFORM_LABEL = {
  android: "admin.waitlist.platform.android",
  ios: "admin.waitlist.platform.ios",
  both: "admin.waitlist.platform.both",
} as const;

/** `/admin/growth/waitlist`: who asked to hear about the app launch, newest first, with a CSV export. */
export function GrowthWaitlistView() {
  const { toast } = useToast();
  const list = useCursorList<Entry>("/admin/app-waitlist", "", adminAppWaitlistResponseSchema);
  // The page endpoint also carries the grand total; one row is enough to read it.
  const summary = useResource("/admin/app-waitlist?limit=1", adminAppWaitlistResponseSchema);

  const exportCsv = async () => {
    try {
      await downloadCsv("/admin/app-waitlist/export.csv", "app-waitlist.csv");
    } catch {
      toast({ tone: "error", title: t("admin.growth.withdrawals.exportFailed") });
    }
  };

  const columns: DataTableColumn<Entry>[] = [
    {
      id: "email",
      header: t("admin.waitlist.col.email"),
      primary: true,
      cell: (entry) => <bdi dir="ltr">{entry.email}</bdi>,
    },
    {
      id: "platform",
      header: t("admin.waitlist.col.platform"),
      cell: (entry) => t(PLATFORM_LABEL[entry.platform]),
    },
    {
      id: "locale",
      header: t("admin.waitlist.col.locale"),
      cell: (entry) => entry.locale.toUpperCase(),
    },
    {
      id: "joined",
      header: t("admin.waitlist.col.joined"),
      cell: (entry) => formatShortDate(entry.createdAt),
    },
    {
      id: "notified",
      header: t("admin.waitlist.col.notified"),
      cell: (entry) =>
        entry.notifiedAt === null
          ? t("admin.waitlist.notified.no")
          : formatShortDate(entry.notifiedAt),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">{t("admin.waitlist.lead")}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-text tabular-nums">
          {summary.status === "ready"
            ? t("admin.waitlist.total", { count: formatNumber(summary.data.total) })
            : null}
        </p>
        <Button variant="secondary" name="export" onClick={() => void exportCsv()}>
          <Download aria-hidden className="size-4" />
          {t("admin.waitlist.export")}
        </Button>
      </div>
      <DataTable
        caption={t("admin.nav.waitlist")}
        columns={columns}
        rows={list.items}
        rowKey={(entry) => entry.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        emptyTitle={t("admin.waitlist.empty")}
      />
    </div>
  );
}
