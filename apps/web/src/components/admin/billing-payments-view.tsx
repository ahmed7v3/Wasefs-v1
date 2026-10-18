"use client";

import { PAYMENT_STATUSES } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import { Button, periodLabel } from "@wasfa/ui";
import { ListChecks, Wallet } from "lucide-react";
import { useMemo } from "react";

import {
  methodListSchema,
  paymentPageSchema,
  type PaymentRow,
} from "../../lib/admin-billing-schemas";
import { dayBoundary, formatDateTime, tOr } from "../../lib/admin-format";
import { durationText } from "../../lib/admin-revenue";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { DataTable, type DataTableColumn } from "./data-table";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { MoneyCell } from "./money-cell";
import { PaymentDrawerBody } from "./payment-drawer";
import { PaymentReviewView } from "./payment-review-view";
import { RecordDrawer, useOpenRecord } from "./record-drawer";
import { StatusChip } from "./status-chip";

export interface BillingPaymentsViewProps {
  canReview: boolean;
  canRefund: boolean;
}

const todayText = () => new Date().toISOString().slice(0, 10);

function SavedViews() {
  const url = useUrlParams();
  const needsReview = url.get("needsReview") === "true";
  const failedToday = url.get("status") === "failed" && url.get("from") !== "";
  const none = !needsReview && !failedToday;
  const views = [
    {
      id: "all",
      label: t("admin.revenue.payments.view.all"),
      pressed: none,
      patch: { needsReview: null, status: null, from: null, to: null },
    },
    {
      id: "waiting",
      label: t("admin.revenue.payments.view.waiting"),
      pressed: needsReview,
      patch: { needsReview: "true", status: null, from: null, to: null },
    },
    {
      id: "failed",
      label: t("admin.revenue.payments.view.failedToday"),
      pressed: failedToday,
      patch: { needsReview: null, status: "failed", from: todayText(), to: null },
    },
  ] as const;
  return (
    <div
      role="group"
      aria-label={t("admin.revenue.payments.views")}
      className="flex flex-wrap gap-2"
    >
      {views.map((view) => (
        <Button
          key={view.id}
          variant={view.pressed ? "primary" : "secondary"}
          aria-pressed={view.pressed}
          name={`view-${view.id}`}
          onClick={() => {
            url.update(view.patch);
          }}
        >
          {view.label}
        </Button>
      ))}
    </div>
  );
}

function PaymentsList({ canRefund }: { canRefund: boolean }) {
  const url = useUrlParams();
  const record = useOpenRecord();
  const methods = useResource("/admin/billing/methods", methodListSchema);
  const methodOptions = useMemo(
    () =>
      methods.status === "ready"
        ? methods.data.items.map((method) => ({ value: method.key, label: method.nameAr }))
        : [],
    [methods],
  );
  const fields = useMemo<FilterField[]>(
    () => [
      { kind: "search", name: "q", label: t("admin.revenue.payments.filter.q") },
      {
        kind: "select",
        name: "status",
        label: t("admin.revenue.payments.filter.status"),
        allLabel: t("admin.revenue.filter.all"),
        options: PAYMENT_STATUSES.map((status) => ({
          value: status,
          label: tOr(`admin.revenue.status.payment.${status}`, status),
        })),
      },
      ...(methodOptions.length > 0
        ? ([
            {
              kind: "select",
              name: "method",
              label: t("admin.revenue.payments.filter.method"),
              allLabel: t("admin.revenue.filter.all"),
              options: methodOptions,
            },
          ] satisfies FilterField[])
        : []),
      { kind: "date", name: "from", label: t("admin.revenue.filter.from") },
      { kind: "date", name: "to", label: t("admin.revenue.filter.to") },
    ],
    [methodOptions],
  );
  const filtersActive = useFiltersActive(fields) || url.get("needsReview") === "true";
  const list = useCursorList(
    "/admin/billing/payments",
    buildQuery({
      q: url.get("q"),
      status: url.get("status"),
      method: url.get("method"),
      from: dayBoundary(url.get("from"), "start"),
      to: dayBoundary(url.get("to"), "end"),
      needsReview: url.get("needsReview") === "true" ? "true" : undefined,
    }),
    paymentPageSchema,
  );

  const columns: DataTableColumn<PaymentRow>[] = [
    {
      id: "time",
      header: t("admin.revenue.payments.col.time"),
      cell: (row) => <span className="tabular-nums">{formatDateTime(row.createdAt)}</span>,
    },
    {
      id: "order",
      header: t("admin.revenue.payments.col.order"),
      primary: true,
      cell: (row) => <bdi dir="ltr">{row.orderNumber}</bdi>,
    },
    {
      id: "customer",
      header: t("admin.revenue.payments.col.customer"),
      cell: (row) => (
        <span className="flex flex-col">
          <span>{row.customer.name ?? "—"}</span>
          <bdi dir="ltr" className="text-sm text-text-muted">
            {row.customer.maskedPhone ?? ""}
          </bdi>
        </span>
      ),
    },
    {
      id: "subject",
      header: t("admin.revenue.payments.col.subject"),
      cell: (row) =>
        row.planKey
          ? `${row.planKey}${row.months ? ` · ${periodLabel(row.months)}` : ""}`
          : (row.packKey ?? "—"),
    },
    { id: "method", header: t("admin.revenue.payments.col.method"), cell: (row) => row.methodKey },
    {
      id: "amount",
      header: t("admin.revenue.payments.col.amount"),
      cell: (row) => <MoneyCell amountMinor={row.amountMinor} currency={row.currency} />,
    },
    {
      id: "status",
      header: t("admin.revenue.payments.col.status"),
      cell: (row) => <StatusChip kind="payment" status={row.status} />,
    },
    {
      id: "age",
      header: t("admin.revenue.payments.col.age"),
      cell: (row) => durationText(row.ageSeconds),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <SavedViews />
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.payments")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(row) => {
          record.open(row.id);
        }}
        openLabel={(row) => t("admin.revenue.payments.open", { number: row.orderNumber })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({
            q: null,
            status: null,
            method: null,
            from: null,
            to: null,
            needsReview: null,
          });
        }}
        emptyTitle={t("admin.revenue.payments.empty")}
        emptyDescription={t("admin.revenue.payments.emptyHint")}
      />
      <RecordDrawer title={t("admin.revenue.payments.detail")}>
        {(id) => <PaymentDrawerBody id={id} canRefund={canRefund} onChanged={list.reload} />}
      </RecordDrawer>
    </div>
  );
}

/**
 * `/admin/billing/payments`: all payments with saved views, or - with `?view=review` and the
 * `payments.review` permission - the manual review queue.
 */
export function BillingPaymentsView({ canReview, canRefund }: BillingPaymentsViewProps) {
  const url = useUrlParams();
  const reviewing = canReview && url.get("view") === "review";
  return (
    <div className="flex flex-col gap-5">
      {canReview ? (
        <div
          role="group"
          aria-label={t("admin.revenue.payments.mode")}
          className="flex flex-wrap gap-2"
        >
          <Button
            variant={reviewing ? "secondary" : "primary"}
            aria-pressed={!reviewing}
            name="mode-all"
            onClick={() => {
              url.update({ view: null });
            }}
          >
            <Wallet aria-hidden className="size-5" />
            {t("admin.revenue.payments.mode.all")}
          </Button>
          <Button
            variant={reviewing ? "primary" : "secondary"}
            aria-pressed={reviewing}
            name="mode-review"
            onClick={() => {
              url.update({ view: "review", open: null });
            }}
          >
            <ListChecks aria-hidden className="size-5" />
            {t("admin.revenue.payments.mode.review")}
          </Button>
        </div>
      ) : null}
      {reviewing ? <PaymentReviewView /> : <PaymentsList canRefund={canRefund} />}
    </div>
  );
}
