"use client";

import { REFUND_STATUSES } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import Link from "next/link";
import { useMemo } from "react";

import { refundPageSchema, type RefundRow } from "../../lib/admin-billing-schemas";
import { formatDateTime, tOr } from "../../lib/admin-format";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { DataTable, type DataTableColumn } from "./data-table";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { MoneyCell } from "./money-cell";
import { StatusChip } from "./status-chip";

/** `/admin/billing/refunds`: refund requests and their state; a refund is issued from its payment. */
export function BillingRefundsView() {
  const url = useUrlParams();
  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "select",
        name: "status",
        label: t("admin.revenue.refunds.filter.status"),
        allLabel: t("admin.revenue.filter.all"),
        options: REFUND_STATUSES.map((value) => ({
          value,
          label: tOr(`admin.revenue.status.refund.${value}`, value),
        })),
      },
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const list = useCursorList(
    "/admin/billing/refunds",
    buildQuery({ status: url.get("status") }),
    refundPageSchema,
  );

  const columns: DataTableColumn<RefundRow>[] = [
    {
      id: "order",
      header: t("admin.revenue.refunds.col.order"),
      primary: true,
      cell: (row) => (
        <Link
          href={`/admin/billing/payments?open=${row.paymentId}`}
          className="text-primary underline-offset-2 hover:underline"
        >
          <bdi dir="ltr">{row.orderNumber}</bdi>
        </Link>
      ),
    },
    {
      id: "amount",
      header: t("admin.revenue.refunds.col.amount"),
      cell: (row) => <MoneyCell amountMinor={row.amountMinor} currency={row.currency} />,
    },
    {
      id: "status",
      header: t("admin.revenue.refunds.col.status"),
      cell: (row) => <StatusChip kind="refund" status={row.status} />,
    },
    { id: "reason", header: t("admin.revenue.refunds.col.reason"), cell: (row) => row.reason },
    {
      id: "reference",
      header: t("admin.revenue.refunds.col.reference"),
      cell: (row) => (row.transferReference ? <bdi dir="ltr">{row.transferReference}</bdi> : "—"),
    },
    {
      id: "created",
      header: t("admin.revenue.refunds.col.created"),
      cell: (row) => <span className="tabular-nums">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">{t("admin.revenue.refunds.lead")}</p>
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.refunds")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ status: null });
        }}
        emptyTitle={t("admin.revenue.refunds.empty")}
        emptyDescription={t("admin.revenue.refunds.emptyHint")}
      />
    </div>
  );
}
