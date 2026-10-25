"use client";

import {
  CONTENT_LOCALES,
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  CONTENT_TYPES,
  type ContentType,
} from "@wasfa/shared/content/constants";
import { t } from "@wasfa/shared/i18n";
import {
  bulkResultSchema,
  contentListResponseSchema,
  personListResponseSchema,
  type ContentItemSummary,
} from "@wasfa/shared/schemas/content";
import { Button, Card, Checkbox, buttonStyles, cn } from "@wasfa/ui";
import { Download, Plus, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { formatNumber, formatShortDate } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import {
  CONTENT_LIST_LIMIT,
  bulkErrorMessage,
  clearFiltersPatch,
  contentRowsToCsv,
  hasExtraFilters,
  isSavedViewActive,
  readContentFilters,
  savedViewPatch,
  savedViews,
  summariseBulk,
  type BulkOutcome,
} from "../../lib/content-list-model";
import { formatZoned, todayKey } from "../../lib/content-time";
import { saveTextFile } from "../../lib/save-text-file";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useContentOptions } from "../../lib/use-content-options";
import { useContentTimeZone } from "../../lib/use-content-time-zone";
import { useUrlParams } from "../../lib/use-url-params";

import { ContentStatusBadge, IssueBadges, LiveBadge, LocaleChip } from "./content-badges";
import { ContentBulkActions, type BulkPayload } from "./content-bulk-dialogs";
import { DataTable, type DataTableColumn } from "./data-table";
import { FilterBar, type FilterField } from "./filter-bar";

export interface ContentListViewProps {
  meId: string;
  permissions: readonly string[];
}

const BULK_CHUNK = 100;

const chip =
  "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-focus";

function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

/** The «جديد» link target: the type of the current list (articles when the list shows all types). */
export function newContentHref(type: string): string {
  const resolved = isContentType(type) ? type : "article";
  return `/admin/content/new?type=${resolved}&locale=ar`;
}

export function ContentListView({ meId, permissions }: ContentListViewProps) {
  const url = useUrlParams();
  const router = useRouter();
  const timeZone = useContentTimeZone();
  const options = useContentOptions();
  const canWrite = permissions.includes("content.write");
  const canManage = permissions.includes("content.manage");

  const filters = readContentFilters(url.get);
  const type = filters["type"] ?? "";
  const query = buildQuery({ ...filters, limit: String(CONTENT_LIST_LIMIT) });
  const list = useCursorList("/admin/content/items", query, contentListResponseSchema);

  // «مسوّداتي» needs the people profile linked to this account.
  const people = useResource("/admin/content/people", personListResponseSchema);
  const myPersonId =
    people.status === "ready"
      ? (people.data.items.find((person) => person.userId === meId)?.id ?? null)
      : null;
  const views = useMemo(
    () => savedViews({ today: todayKey(timeZone), myPersonId }),
    [timeZone, myPersonId],
  );

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<{
    outcomes: BulkOutcome[];
    titles: Map<string, string>;
  } | null>(null);

  // A reload or a new filter can drop rows from the page: forget selected ids that are gone.
  useEffect(() => {
    const present = new Set(list.items.map((item) => item.id));
    setSelected((current) => {
      const kept = [...current].filter((id) => present.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [list.items]);

  const fields = useMemo<FilterField[]>(() => {
    const categories = options.status === "ready" ? options.data.categories : [];
    const authors = options.status === "ready" ? options.data.authors : [];
    const reviewers = options.status === "ready" ? options.data.reviewers : [];
    return [
      {
        kind: "search",
        name: "q",
        label: t("admin.content.filter.q"),
        placeholder: t("admin.content.filter.qHint"),
      },
      {
        kind: "select",
        name: "locale",
        label: t("admin.content.filter.locale"),
        allLabel: t("admin.filters.all"),
        options: CONTENT_LOCALES.map((value) => ({
          value,
          label: t(`admin.content.locale.${value}`),
        })),
      },
      {
        kind: "select",
        name: "categoryId",
        label: t("admin.content.filter.category"),
        allLabel: t("admin.filters.all"),
        options: categories.map((category) => ({ value: category.id, label: category.nameAr })),
      },
      {
        kind: "select",
        name: "authorId",
        label: t("admin.content.filter.author"),
        allLabel: t("admin.filters.all"),
        options: authors.map((person) => ({ value: person.id, label: person.name })),
      },
      {
        kind: "select",
        name: "reviewerId",
        label: t("admin.content.filter.reviewer"),
        allLabel: t("admin.filters.all"),
        options: reviewers.map((person) => ({ value: person.id, label: person.name })),
      },
      {
        kind: "select",
        name: "source",
        label: t("admin.content.filter.source"),
        allLabel: t("admin.filters.all"),
        options: CONTENT_SOURCES.map((value) => ({
          value,
          label: t(`admin.content.source.${value}`),
        })),
      },
      { kind: "date", name: "from", label: t("admin.content.filter.from") },
      { kind: "date", name: "to", label: t("admin.content.filter.to") },
      { kind: "date", name: "scheduledFrom", label: t("admin.content.filter.scheduledFrom") },
      { kind: "date", name: "scheduledTo", label: t("admin.content.filter.scheduledTo") },
    ];
  }, [options]);

  const filtersActive = hasExtraFilters(filters);
  const clearAll = () => {
    url.update(clearFiltersPatch());
    setSelected(new Set());
  };

  const toggles = [
    { name: "live", label: t("admin.content.filter.live") },
    { name: "reviewOverdue", label: t("admin.content.filter.reviewOverdue") },
    { name: "hasIssues", label: t("admin.content.filter.hasIssues") },
  ] as const;

  const allSelected = list.items.length > 0 && list.items.every((item) => selected.has(item.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(list.items.map((item) => item.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = async (payload: BulkPayload): Promise<void> => {
    const ids = [...selected];
    const outcomes: BulkOutcome[] = [];
    // The API takes at most 100 ids per request: a larger selection goes out in order, in chunks.
    for (let start = 0; start < ids.length; start += BULK_CHUNK) {
      const chunk = ids.slice(start, start + BULK_CHUNK);
      const answer = await api("/admin/content/bulk", {
        method: "POST",
        body: { ...payload, ids: chunk },
        schema: bulkResultSchema,
      });
      outcomes.push(...answer.results);
    }
    setResults({ outcomes, titles: new Map(list.items.map((item) => [item.id, item.title])) });
    // Failed items stay selected so the action can be retried on exactly those.
    const failed = new Set(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.id));
    setSelected(failed);
    list.reload();
  };

  const exportCsv = () => {
    saveTextFile(`content-${todayKey(timeZone)}.csv`, contentRowsToCsv(list.items));
  };

  const columns: DataTableColumn<ContentItemSummary>[] = [
    ...(canManage
      ? [
          {
            id: "select",
            header: t("admin.content.col.select"),
            className: "w-14",
            cell: (row: ContentItemSummary) => (
              // The row opens the editor on click; the checkbox must not.
              <span
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Checkbox
                  name="select"
                  label={<span className="sr-only">{row.title}</span>}
                  checked={selected.has(row.id)}
                  onChange={() => {
                    toggleOne(row.id);
                  }}
                />
              </span>
            ),
          },
        ]
      : []),
    {
      id: "title",
      header: t("admin.content.col.title"),
      primary: true,
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-words">{row.title}</span>
            <LocaleChip locale={row.locale} />
          </span>
          <bdi dir="ltr" className="text-start text-sm font-normal text-text-muted">
            {row.slug}
          </bdi>
        </span>
      ),
    },
    {
      id: "status",
      header: t("admin.content.col.status"),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <ContentStatusBadge status={row.status} />
          {row.live ? <LiveBadge /> : null}
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
      className: "hidden xl:table-cell",
      cell: (row) => row.author?.name ?? "—",
    },
    {
      id: "reviewer",
      header: t("admin.content.col.reviewer"),
      className: "hidden xl:table-cell",
      cell: (row) => row.reviewer?.name ?? "—",
    },
    {
      id: "source",
      header: t("admin.content.col.source"),
      className: "hidden xl:table-cell",
      cell: (row) =>
        row.source === "api" && row.apiKeyName
          ? `${t("admin.content.source.api")} · ${row.apiKeyName}`
          : t(`admin.content.source.${row.source}`),
    },
    {
      id: "updated",
      header: t("admin.content.col.updated"),
      cell: (row) => formatShortDate(row.updatedAt),
    },
    {
      id: "when",
      header: t("admin.content.col.when"),
      className: "hidden xl:table-cell",
      cell: (row) =>
        row.scheduledAt
          ? t("admin.content.scheduledFor", { date: formatZoned(row.scheduledAt, timeZone) })
          : row.publishedAt
            ? t("admin.content.publishedOn", { date: formatZoned(row.publishedAt, timeZone) })
            : "—",
    },
    {
      id: "issues",
      header: t("admin.content.col.issues"),
      cell: (row) => <IssueBadges issues={row.issues} />,
    },
    {
      id: "words",
      header: t("admin.content.col.words"),
      className: "hidden xl:table-cell",
      cell: (row) => formatNumber(row.wordCount),
    },
  ];

  const summary = results ? summariseBulk(results.outcomes) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t("admin.content.views.label")}
          className="flex flex-wrap gap-2"
        >
          {views.map((view) => {
            const active = isSavedViewActive(view, filters);
            return (
              <button
                key={view.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  url.update(active ? clearFiltersPatch() : savedViewPatch(view));
                }}
                className={cn(
                  chip,
                  active
                    ? "border-primary bg-primary text-on-primary"
                    : "border-border bg-surface text-text hover:bg-primary-soft",
                )}
              >
                {t(view.label)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={list.items.length === 0}>
            <Download aria-hidden className="size-5" />
            {t("admin.content.exportCsv")}
          </Button>
          {canWrite ? (
            <Link href={newContentHref(type)} className={buttonStyles({})}>
              <Plus aria-hidden className="size-5" />
              {t("admin.content.new")}
            </Link>
          ) : null}
        </div>
      </div>

      <div
        role="group"
        aria-label={t("admin.content.filter.status")}
        className="flex flex-wrap gap-2"
      >
        <button
          type="button"
          aria-pressed={filters["status"] === ""}
          onClick={() => {
            url.update({ status: null });
          }}
          className={cn(
            chip,
            filters["status"] === ""
              ? "border-primary bg-primary text-on-primary"
              : "border-border bg-surface text-text hover:bg-primary-soft",
          )}
        >
          {t("admin.filters.all")}
        </button>
        {CONTENT_STATUSES.map((status) => {
          const active = filters["status"] === status;
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => {
                url.update({ status: active ? null : status });
              }}
              className={cn(
                chip,
                active
                  ? "border-primary bg-primary text-on-primary"
                  : "border-border bg-surface text-text hover:bg-primary-soft",
              )}
            >
              {t(`admin.content.status.${status}`)}
            </button>
          );
        })}
      </div>

      <FilterBar fields={fields} />
      <div
        role="group"
        aria-label={t("admin.content.filter.toggles")}
        className="flex flex-wrap gap-x-5"
      >
        {toggles.map((toggle) => (
          <Checkbox
            key={toggle.name}
            name={toggle.name}
            label={toggle.label}
            checked={filters[toggle.name] === "true"}
            onChange={(event) => {
              url.update({ [toggle.name]: event.target.checked ? "true" : null });
            }}
          />
        ))}
      </div>

      {canManage && list.items.length > 0 ? (
        <Checkbox
          name="select-all"
          label={t("admin.content.selectAll", { count: list.items.length })}
          checked={allSelected}
          onChange={toggleAll}
        />
      ) : null}

      <div aria-live="polite" aria-atomic="true">
        {summary && results ? (
          <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-text">
                {t("admin.content.bulk.result", {
                  ok: summary.succeeded,
                  failed: summary.failed.length,
                })}
              </p>
              <button
                type="button"
                aria-label={t("ui.close")}
                onClick={() => {
                  setResults(null);
                }}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
              >
                <X aria-hidden className="size-5" />
              </button>
            </div>
            {summary.failed.length > 0 ? (
              <ul className="flex flex-col gap-2 text-sm">
                {summary.failed.map((outcome) => (
                  <li key={outcome.id} className="flex flex-col gap-0.5">
                    <span className="font-semibold">
                      {results.titles.get(outcome.id) ?? outcome.id}
                    </span>
                    <span className="text-danger">{bulkErrorMessage(outcome.code)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
      </div>

      <DataTable
        caption={t("admin.content.caption")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(row) => {
          router.push(`/admin/content/${row.id}`);
        }}
        openLabel={(row) => t("admin.content.openItem", { title: row.title })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={clearAll}
        emptyTitle={t("admin.content.empty")}
        emptyDescription={t("admin.content.emptyHint")}
      />

      {canManage && selected.size > 0 ? <div aria-hidden className="h-24" /> : null}
      {canManage && selected.size > 0 ? (
        <div
          role="region"
          aria-label={t("admin.content.bulk.bar")}
          className="fixed inset-x-0 bottom-0 z-20 max-h-[45dvh] overflow-y-auto border-t border-border bg-surface p-3 shadow-raised lg:start-64"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="me-auto font-semibold text-text" role="status">
              {t("admin.content.bulk.selected", { count: selected.size })}
            </p>
            <ContentBulkActions
              count={selected.size}
              options={options.status === "ready" ? options.data : null}
              timeZone={timeZone}
              onRun={runBulk}
            />
            <Button
              variant="ghost"
              onClick={() => {
                setSelected(new Set());
              }}
            >
              {t("admin.content.bulk.clear")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
