"use client";

import { t } from "@wasfa/shared/i18n";
import { reviewInboxResponseSchema, type ReviewInboxItem } from "@wasfa/shared/schemas/content";
import { Badge, Checkbox } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { formatNumber } from "../../lib/admin-format";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { useContentOptions } from "../../lib/use-content-options";
import { useUrlParams } from "../../lib/use-url-params";

import { LocaleChip } from "./content-badges";
import { DataTable, type DataTableColumn } from "./data-table";
import { FilterBar, type FilterField } from "./filter-bar";

/** Hours since submission as «3 ساعات» or, from two days on, «5 أيام». */
export function reviewAgeLabel(hours: number): string {
  return hours < 48
    ? t("admin.content.review.ageHours", { count: Math.max(0, hours) })
    : t("admin.content.review.ageDays", { count: Math.floor(hours / 24) });
}

/** The review inbox (`content.review`): oldest submission first, straight to the editor's Review tab. */
export function ContentReviewView() {
  const url = useUrlParams();
  const router = useRouter();
  const options = useContentOptions();
  const mine = url.get("mine") === "true";

  const query = buildQuery({
    categoryId: url.get("categoryId"),
    mine: mine ? "true" : "",
  });
  const list = useCursorList("/admin/content/review-inbox", query, reviewInboxResponseSchema);

  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "select",
        name: "categoryId",
        label: t("admin.content.filter.category"),
        allLabel: t("admin.filters.all"),
        options:
          options.status === "ready"
            ? options.data.categories.map((category) => ({
                value: category.id,
                label: category.nameAr,
              }))
            : [],
      },
    ],
    [options],
  );

  const columns: DataTableColumn<ReviewInboxItem>[] = [
    {
      id: "title",
      header: t("admin.content.col.title"),
      primary: true,
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-words">{row.title}</span>
          <LocaleChip locale={row.locale} />
        </span>
      ),
    },
    {
      id: "category",
      header: t("admin.content.col.category"),
      cell: (row) => row.category?.name ?? "—",
    },
    {
      id: "author",
      header: t("admin.content.col.author"),
      cell: (row) => row.author?.name ?? "—",
    },
    {
      id: "age",
      header: t("admin.content.review.col.age"),
      cell: (row) => reviewAgeLabel(row.ageHours),
    },
    {
      id: "diff",
      header: t("admin.content.review.col.diff"),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr" className="tabular-nums">
            <span className="text-success">+{formatNumber(row.diffStats.added)}</span>{" "}
            <span className="text-danger">−{formatNumber(row.diffStats.removed)}</span>
          </bdi>
          <Badge tone={row.hasApprovedBefore ? "info" : "warning"}>
            {t(
              row.hasApprovedBefore ? "admin.content.review.changes" : "admin.content.review.first",
            )}
          </Badge>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <FilterBar fields={fields} />
        <Checkbox
          name="mine"
          label={t("admin.content.review.mine")}
          checked={mine}
          onChange={(event) => {
            url.update({ mine: event.target.checked ? "true" : null });
          }}
        />
      </div>
      <DataTable
        caption={t("admin.nav.content.review")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(row) => {
          router.push(`/admin/content/${row.id}?tab=review`);
        }}
        openLabel={(row) => t("admin.content.review.open", { title: row.title })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={mine || url.get("categoryId") !== ""}
        onClearFilters={() => {
          url.update({ mine: null, categoryId: null });
        }}
        emptyTitle={t("admin.content.review.empty")}
        emptyDescription={t("admin.content.review.emptyHint")}
      />
    </div>
  );
}
