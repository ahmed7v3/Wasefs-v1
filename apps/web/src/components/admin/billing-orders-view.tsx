"use client";

import { ORDER_KINDS, ORDER_STATUSES } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import { Button, ReceiptSheet, periodLabel, useToast } from "@wasfa/ui";
import { Copy, Mail } from "lucide-react";
import { useMemo } from "react";

import {
  orderDetailSchema,
  orderPageSchema,
  type OrderDetail,
  type OrderRow,
} from "../../lib/admin-billing-schemas";
import { dayBoundary, formatDateTime, tOr } from "../../lib/admin-format";
import {
  receiptItemText,
  receiptLines,
  receiptMeta,
  receiptParties,
  receiptTotals,
} from "../../lib/admin-receipt";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { DataTable, type DataTableColumn } from "./data-table";
import { DetailList, DetailSection } from "./detail-list";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { MoneyCell } from "./money-cell";
import { RecordDrawer, useOpenRecord } from "./record-drawer";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";

function OrderBody({ order, canWrite }: { order: OrderDetail; canWrite: boolean }) {
  const { toast } = useToast();
  const reauth = useReauth();
  const receipt = order.receipt;
  const subject = order.planKey
    ? `${order.planKey}${order.months ? ` · ${periodLabel(order.months)}` : ""}`
    : (order.packKey ?? "—");

  const copyLink = () => {
    const link = `${window.location.origin}/billing/orders/${order.id}`;
    navigator.clipboard.writeText(link).then(
      () => {
        toast({ tone: "success", title: t("admin.revenue.orders.linkCopied") });
      },
      () => {
        toast({ tone: "error", title: t("admin.revenue.payment.copyFailed") });
      },
    );
  };

  const resend = () => {
    reauth
      .run(() => api(`/admin/billing/orders/${order.id}/resend-receipt`, { method: "POST" }))
      .then(
        () => {
          toast({ tone: "success", title: t("admin.revenue.orders.receiptSent") });
        },
        (error: unknown) => {
          toast({ tone: "error", title: toApiError(error).message });
        },
      );
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusChip kind="order" status={order.status} />
        <MoneyCell
          amountMinor={order.totalMinor}
          currency={order.currency}
          className="font-heading text-2xl font-semibold"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {canWrite && receipt ? (
          <Button variant="secondary" name="resend-receipt" onClick={resend}>
            <Mail aria-hidden className="size-5" />
            {t("admin.revenue.orders.resend")}
          </Button>
        ) : null}
        <Button variant="secondary" name="copy-link" onClick={copyLink}>
          <Copy aria-hidden className="size-5" />
          {t("admin.revenue.orders.copyLink")}
        </Button>
      </div>
      <DetailList
        items={[
          {
            label: t("admin.revenue.orders.col.number"),
            value: <bdi dir="ltr">{order.number}</bdi>,
          },
          { label: t("admin.revenue.orders.col.subject"), value: subject },
          { label: t("admin.revenue.orders.col.created"), value: formatDateTime(order.createdAt) },
          {
            label: t("admin.revenue.orders.col.paid"),
            value: order.paidAt ? formatDateTime(order.paidAt) : null,
          },
        ]}
      />
      {order.payments.length > 0 ? (
        <DetailSection title={t("admin.revenue.orders.payments")}>
          <ul className="flex flex-col divide-y divide-border">
            {order.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <a
                  href={`/admin/billing/payments?open=${payment.id}`}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  <bdi dir="ltr">{payment.reference}</bdi>
                </a>
                <StatusChip kind="payment" status={payment.status} />
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}
      <DetailSection title={t("admin.revenue.orders.receipt")}>
        {receipt ? (
          <ReceiptSheet
            currency={receipt.currency}
            title={t("billing.receipt.title")}
            number={receipt.number}
            meta={receiptMeta(receipt)}
            parties={receiptParties(receipt)}
            itemLabel={receiptItemText(receipt)}
            lines={receiptLines(receipt, receiptItemText(receipt))}
            totals={receiptTotals(receipt)}
            notes={receipt.taxMode === "inclusive" ? [t("billing.tax.inclusive")] : []}
          />
        ) : (
          <p className="text-base text-text-muted">{t("admin.revenue.orders.noReceipt")}</p>
        )}
      </DetailSection>
    </>
  );
}

/** `/admin/billing/orders`: orders searchable by number, with the receipt in the drawer. */
export function BillingOrdersView({ canWrite }: { canWrite: boolean }) {
  const url = useUrlParams();
  const record = useOpenRecord();
  const fields = useMemo<FilterField[]>(
    () => [
      { kind: "search", name: "q", label: t("admin.revenue.orders.filter.q"), ltr: true },
      {
        kind: "select",
        name: "status",
        label: t("admin.revenue.orders.filter.status"),
        allLabel: t("admin.revenue.filter.all"),
        options: ORDER_STATUSES.map((value) => ({
          value,
          label: tOr(`admin.revenue.status.order.${value}`, value),
        })),
      },
      {
        kind: "select",
        name: "kind",
        label: t("admin.revenue.orders.filter.kind"),
        allLabel: t("admin.revenue.filter.all"),
        options: ORDER_KINDS.map((value) => ({
          value,
          label: tOr(`admin.revenue.orders.kind.${value}`, value),
        })),
      },
      { kind: "date", name: "from", label: t("admin.revenue.filter.from") },
      { kind: "date", name: "to", label: t("admin.revenue.filter.to") },
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const list = useCursorList(
    "/admin/billing/orders",
    buildQuery({
      q: url.get("q"),
      status: url.get("status"),
      kind: url.get("kind"),
      from: dayBoundary(url.get("from"), "start"),
      to: dayBoundary(url.get("to"), "end"),
    }),
    orderPageSchema,
  );

  const columns: DataTableColumn<OrderRow>[] = [
    {
      id: "number",
      header: t("admin.revenue.orders.col.number"),
      primary: true,
      cell: (row) => <bdi dir="ltr">{row.number}</bdi>,
    },
    { id: "owner", header: t("admin.revenue.orders.col.owner"), cell: (row) => row.owner.label },
    {
      id: "subject",
      header: t("admin.revenue.orders.col.subject"),
      cell: (row) => row.planKey ?? row.packKey ?? "—",
    },
    {
      id: "status",
      header: t("admin.revenue.orders.col.status"),
      cell: (row) => <StatusChip kind="order" status={row.status} />,
    },
    {
      id: "total",
      header: t("admin.revenue.orders.col.total"),
      cell: (row) => <MoneyCell amountMinor={row.totalMinor} currency={row.currency} />,
    },
    {
      id: "created",
      header: t("admin.revenue.orders.col.created"),
      cell: (row) => <span className="tabular-nums">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.orders")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(row) => {
          record.open(row.id);
        }}
        openLabel={(row) => t("admin.revenue.orders.open", { number: row.number })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ q: null, status: null, kind: null, from: null, to: null });
        }}
        emptyTitle={t("admin.revenue.orders.empty")}
        emptyDescription={t("admin.revenue.orders.emptyHint")}
      />
      <RecordDrawer title={t("admin.revenue.orders.detail")}>
        {(id) => <OrderDrawerBody id={id} canWrite={canWrite} />}
      </RecordDrawer>
    </div>
  );
}

function OrderDrawerBody({ id, canWrite }: { id: string; canWrite: boolean }) {
  const resource = useResource(`/admin/billing/orders/${id}`, orderDetailSchema);
  return (
    <ResourceBoundary resource={resource}>
      {(order) => <OrderBody order={order} canWrite={canWrite} />}
    </ResourceBoundary>
  );
}
