"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Card, EmptyState, Skeleton, cn } from "@wasfa/ui";
import { EllipsisVertical, SearchX } from "lucide-react";
import { Fragment } from "react";

import { ErrorNotice } from "../error-notice";
import { PopoverMenu } from "../popover-menu";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/*
 * The admin data table (DESIGN-SYSTEM §5.3): dense 48 px rows, sticky header, keyset "load more" (no
 * page numbers), row click opens the detail, actions in an end-aligned menu. Below `md` the same rows
 * render as a list of cards, so the page never scrolls sideways. Filters and the cursor live outside
 * (`useCursorList`, URL params): this component only draws.
 */

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** The row's name: the control that opens it, and the title of its card on a phone. */
  primary?: boolean;
  /** Extra classes of the cells of this column (width, alignment). */
  className?: string;
}

export interface RowAction {
  id: string;
  label: string;
  icon?: LucideIcon;
  tone?: "danger";
  onSelect: () => void;
}

export interface DataTableProps<T> {
  /** Accessible name of the table. */
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  status: "loading" | "ready" | "error";
  error?: unknown;
  onRetry?: (() => void) | undefined;
  /** Opens the row's detail (drawer, page or inline expansion). */
  onOpenRow?: ((row: T) => void) | undefined;
  /** Accessible name of the open control of a row ("Details of Sara"). */
  openLabel?: ((row: T) => string) | undefined;
  rowActions?: ((row: T) => RowAction[]) | undefined;
  actionsLabel?: ((row: T) => string) | undefined;
  /** For rows that expand in place (the audit log): is this row open, and what it shows. */
  isExpanded?: ((row: T) => boolean) | undefined;
  renderExpanded?: ((row: T) => ReactNode) | undefined;
  nextCursor?: string | null | undefined;
  loadingMore?: boolean | undefined;
  loadMoreError?: unknown;
  onLoadMore?: (() => void) | undefined;
  /** True when a filter is applied: the empty state then offers to clear them. */
  filtersActive?: boolean | undefined;
  onClearFilters?: (() => void) | undefined;
  emptyTitle: string;
  emptyDescription?: string | undefined;
  emptyAction?: ReactNode;
}

const SKELETON_ROWS = 5;

const menuItem =
  "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-base font-semibold transition-colors duration-150 hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus";

function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  if (actions.length === 0) return null;
  return (
    <PopoverMenu
      label={label}
      triggerClassName="inline-flex size-11 items-center justify-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
      trigger={<EllipsisVertical aria-hidden className="size-5" />}
    >
      {(close) => (
        <ul className="flex flex-col gap-1">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <li key={action.id}>
                <button
                  type="button"
                  name={action.id}
                  className={cn(menuItem, action.tone === "danger" ? "text-danger" : "text-text")}
                  onClick={() => {
                    close();
                    action.onSelect();
                  }}
                >
                  {Icon ? <Icon aria-hidden className="size-5 shrink-0 rtl:-scale-x-100" /> : null}
                  {action.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </PopoverMenu>
  );
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  status,
  error,
  onRetry,
  onOpenRow,
  openLabel,
  rowActions,
  actionsLabel,
  isExpanded,
  renderExpanded,
  nextCursor,
  loadingMore,
  loadMoreError,
  onLoadMore,
  filtersActive,
  onClearFilters,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: DataTableProps<T>) {
  if (status === "error") return <ErrorNotice error={error} onRetry={onRetry} />;

  if (status === "loading") {
    return (
      <Card elevation="flat" padding="none" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        <ul className="divide-y divide-border">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li key={index} className="flex h-12 items-center gap-4 px-4">
              <Skeleton className="h-5 w-1/4" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="hidden h-5 w-1/6 md:block" />
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card elevation="flat">
        <EmptyState
          icon={<SearchX />}
          title={emptyTitle}
          description={filtersActive ? t("admin.table.emptyFiltered") : emptyDescription}
          action={
            filtersActive && onClearFilters ? (
              <Button variant="secondary" onClick={onClearFilters}>
                {t("admin.filters.clear")}
              </Button>
            ) : (
              emptyAction
            )
          }
        />
      </Card>
    );
  }

  const primary = columns.find((column) => column.primary) ?? columns[0];
  const open = (row: T) => {
    onOpenRow?.(row);
  };

  const opener = (row: T, content: ReactNode) =>
    onOpenRow ? (
      <button
        type="button"
        onClick={(event) => {
          // The row also handles clicks; the button alone must not run the handler twice.
          event.stopPropagation();
          open(row);
        }}
        aria-label={openLabel?.(row)}
        aria-expanded={isExpanded ? isExpanded(row) : undefined}
        className="max-w-full rounded-sm text-start font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {content}
      </button>
    ) : (
      content
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status">
        {t("admin.table.count", { count: rows.length })}
      </p>

      {/* Desktop and tablet. */}
      <Card elevation="flat" padding="none" className="hidden md:block">
        <table className="w-full border-separate border-spacing-0 text-start text-base">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn(
                    "sticky top-16 z-10 h-12 border-b border-border bg-neutral-50 px-4 text-start text-sm font-semibold text-text-muted first:rounded-ss-xl last:rounded-se-xl",
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
              {rowActions ? (
                <th
                  scope="col"
                  className="sticky top-16 z-10 h-12 w-16 border-b border-border bg-neutral-50 px-2 text-end last:rounded-se-xl"
                >
                  <span className="sr-only">{t("admin.table.actions")}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const actions = rowActions?.(row) ?? [];
              const expanded = isExpanded?.(row) ?? false;
              return (
                <Fragment key={rowKey(row)}>
                  <tr
                    onClick={
                      onOpenRow
                        ? () => {
                            open(row);
                          }
                        : undefined
                    }
                    className={cn(
                      "h-12 transition-colors duration-150 hover:bg-primary-soft/50",
                      onOpenRow && "cursor-pointer",
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "max-w-xs wrap-anywhere border-b border-border px-4 tabular-nums",
                          column.className,
                        )}
                      >
                        {column.id === primary?.id
                          ? opener(row, column.cell(row))
                          : column.cell(row)}
                      </td>
                    ))}
                    {rowActions ? (
                      <td
                        className="w-16 border-b border-border px-2 text-end"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <RowMenu
                          label={actionsLabel?.(row) ?? t("admin.table.actions")}
                          actions={actions}
                        />
                      </td>
                    ) : null}
                  </tr>
                  {expanded && renderExpanded ? (
                    <tr>
                      <td
                        colSpan={columns.length + (rowActions ? 1 : 0)}
                        className="border-b border-border bg-neutral-50 p-4"
                      >
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Phone: one card per row. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => {
          const actions = rowActions?.(row) ?? [];
          const expanded = isExpanded?.(row) ?? false;
          return (
            <li key={rowKey(row)}>
              <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 text-base">
                    {primary ? opener(row, primary.cell(row)) : null}
                  </div>
                  {rowActions ? (
                    <div className="-my-2 -me-2 shrink-0">
                      <RowMenu
                        label={actionsLabel?.(row) ?? t("admin.table.actions")}
                        actions={actions}
                      />
                    </div>
                  ) : null}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {columns
                    .filter((column) => column.id !== primary?.id)
                    .map((column) => (
                      <Fragment key={column.id}>
                        <dt className="text-text-muted">{column.header}</dt>
                        <dd className="min-w-0 break-words tabular-nums">{column.cell(row)}</dd>
                      </Fragment>
                    ))}
                </dl>
                {expanded && renderExpanded ? renderExpanded(row) : null}
              </Card>
            </li>
          );
        })}
      </ul>

      {loadMoreError ? <ErrorNotice error={loadMoreError} onRetry={onLoadMore} /> : null}
      {nextCursor && onLoadMore ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={onLoadMore} loading={loadingMore ?? false}>
            {t("admin.table.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
