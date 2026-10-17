"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, buttonStyles, lineLabel, periodLabel, useToast } from "@wasfa/ui";
import { Copy, Undo2, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { paymentRecordSchema, type PaymentRecord } from "../../lib/admin-billing-schemas";
import { formatDateTime, tOr } from "../../lib/admin-format";
import { flagText } from "../../lib/admin-revenue";
import { useResource } from "../../lib/use-admin-data";

import { DetailList, DetailSection } from "./detail-list";
import { MoneyCell } from "./money-cell";
import { RefundDialog } from "./refund-dialog";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";
import { Timeline } from "./timeline";

const REFUNDABLE = ["succeeded", "partially_refunded"];

function Body({
  record,
  canRefund,
  onChanged,
}: {
  record: PaymentRecord;
  canRefund: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [refunding, setRefunding] = useState(false);
  const { payment, order, customer } = record;
  const subject = order.planKey
    ? `${order.planKey}${order.months ? ` · ${periodLabel(order.months)}` : ""}`
    : (order.packKey ?? "");

  const copyReference = () => {
    navigator.clipboard.writeText(payment.reference).then(
      () => {
        toast({ tone: "success", title: t("admin.revenue.payment.copied") });
      },
      () => {
        toast({ tone: "error", title: t("admin.revenue.payment.copyFailed") });
      },
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusChip kind="payment" status={payment.status} />
        <MoneyCell
          amountMinor={payment.amountMinor}
          currency={payment.currency}
          className="font-heading text-2xl font-semibold"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {canRefund && REFUNDABLE.includes(payment.status) ? (
          <Button
            variant="secondary"
            name="refund"
            onClick={() => {
              setRefunding(true);
            }}
          >
            <Undo2 aria-hidden className="size-5" />
            {t("admin.revenue.payment.refund")}
          </Button>
        ) : null}
        {customer.id ? (
          <Link
            href={`/admin/users/${customer.id}`}
            className={buttonStyles({ variant: "secondary" })}
          >
            <User aria-hidden className="size-5" />
            {t("admin.revenue.payment.openUser")}
          </Link>
        ) : null}
        <Button variant="secondary" name="copy-reference" onClick={copyReference}>
          <Copy aria-hidden className="size-5" />
          {t("admin.revenue.payment.copyReference")}
        </Button>
      </div>
      {payment.flags.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg bg-danger-soft px-4 py-3 text-base text-danger">
          {payment.flags.map((flag) => (
            <li key={flag}>{flagText(flag)}</li>
          ))}
        </ul>
      ) : null}
      <DetailList
        items={[
          {
            label: t("admin.revenue.payment.reference"),
            value: <bdi dir="ltr">{payment.reference}</bdi>,
          },
          {
            label: t("admin.revenue.payment.order"),
            value: (
              <Link
                href={`/admin/billing/orders?open=${order.id}`}
                className="text-primary underline-offset-2 hover:underline"
              >
                <bdi dir="ltr">{order.number}</bdi>
              </Link>
            ),
          },
          { label: t("admin.revenue.payment.subject"), value: subject },
          { label: t("admin.revenue.payment.method"), value: payment.methodKey },
          { label: t("admin.revenue.payment.txn"), value: payment.txnIdMasked },
          { label: t("admin.revenue.payment.sender"), value: payment.senderPhoneMasked },
          { label: t("admin.revenue.payment.created"), value: formatDateTime(payment.createdAt) },
        ]}
      />
      <DetailSection title={t("admin.revenue.payment.breakdown")}>
        <ul className="flex flex-col divide-y divide-border">
          {order.quoteLines.map((line, index) => (
            <li key={`${line.kind}-${String(index)}`} className="flex justify-between gap-3 py-2">
              <span>{line.kind === "plan" ? subject : lineLabel(line.labelKey)}</span>
              <MoneyCell amountMinor={line.amountMinor} currency={payment.currency} />
            </li>
          ))}
          <li className="flex justify-between gap-3 py-2">
            <span>{t("admin.revenue.payment.tax")}</span>
            <MoneyCell amountMinor={order.totals.taxMinor} currency={payment.currency} />
          </li>
          <li className="flex justify-between gap-3 py-2">
            <span>{t("admin.revenue.payment.fee")}</span>
            <MoneyCell amountMinor={order.totals.feeMinor} currency={payment.currency} />
          </li>
          <li className="flex justify-between gap-3 py-2 font-semibold">
            <span>{t("admin.revenue.payment.total")}</span>
            <MoneyCell amountMinor={order.totals.totalMinor} currency={payment.currency} />
          </li>
        </ul>
      </DetailSection>
      <DetailSection title={t("admin.revenue.payment.timeline")}>
        <Timeline
          label={t("admin.revenue.payment.timeline")}
          entries={record.timeline.map((event, index) => ({
            key: `${event.type}-${String(index)}`,
            title: tOr(`admin.revenue.event.${event.type}`, event.type),
            time: formatDateTime(event.time),
            detail:
              event.signatureOk === false ? t("admin.revenue.payment.signatureBad") : undefined,
          }))}
        />
      </DetailSection>
      {record.refunds.length > 0 ? (
        <DetailSection title={t("admin.revenue.payment.refunds")}>
          <ul className="flex flex-col divide-y divide-border">
            {record.refunds.map((refund) => (
              <li
                key={refund.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <MoneyCell amountMinor={refund.amountMinor} currency={refund.currency} />
                <StatusChip kind="refund" status={refund.status} />
                <span className="text-sm text-text-muted">{formatDateTime(refund.createdAt)}</span>
              </li>
            ))}
          </ul>
        </DetailSection>
      ) : null}
      <DetailSection title={t("admin.revenue.payment.customer")}>
        <DetailList
          items={[
            { label: t("admin.revenue.payment.customerName"), value: customer.name },
            { label: t("admin.revenue.payment.customerPhone"), value: customer.maskedPhone },
            { label: t("admin.revenue.payment.customerEmail"), value: customer.maskedEmail },
            {
              label: t("admin.revenue.payment.previousOrders"),
              value: String(customer.previousPaidOrders),
            },
            { label: t("admin.revenue.payment.currentPlan"), value: customer.currentPlanKey },
            { label: t("admin.revenue.payment.referral"), value: customer.referralSourceCode },
          ]}
        />
      </DetailSection>
      <RefundDialog
        open={refunding}
        onOpenChange={setRefunding}
        record={record}
        onDone={onChanged}
      />
    </>
  );
}

/** The payment drawer (ADMIN-CONSOLE-SPEC §4.1): breakdown, timeline, customer and the actions. */
export function PaymentDrawerBody({
  id,
  canRefund,
  onChanged,
}: {
  id: string;
  canRefund: boolean;
  onChanged: () => void;
}) {
  const resource = useResource(`/admin/billing/payments/${id}/record`, paymentRecordSchema);
  return (
    <ResourceBoundary resource={resource}>
      {(record) => (
        <Body
          record={record}
          canRefund={canRefund}
          onChanged={() => {
            resource.reload();
            onChanged();
          }}
        />
      )}
    </ResourceBoundary>
  );
}
