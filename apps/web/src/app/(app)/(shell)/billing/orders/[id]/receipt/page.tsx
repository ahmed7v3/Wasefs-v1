import { t } from "@wasfa/shared/i18n";
import { orderIdParamSchema } from "@wasfa/shared/schemas/billing";
import {
  ReceiptSheet,
  buttonStyles,
  lineLabel,
  periodLabel,
  type ReceiptLine,
  type ReceiptParty,
  type ReceiptTotal,
} from "@wasfa/ui";
import Link from "next/link";

import { PrintButton } from "../../../../../../../components/billing/print-button";
import { Notice } from "../../../../../../../components/notice";
import { ApiRequestError } from "../../../../../../../lib/api-error";
import { receiptSchema, type ReceiptView } from "../../../../../../../lib/billing-schemas";
import { getCatalog } from "../../../../../../../lib/billing-server";
import { formatDate } from "../../../../../../../lib/dates";
import { requireOnboarded, serverApi } from "../../../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("billing.receipt.title") };

function itemText(receipt: ReceiptView, names: Readonly<Record<string, string>>): string {
  const { item } = receipt;
  if (item.kind === "credit_pack") {
    return item.packKey ? (names[item.packKey] ?? item.packKey) : t("billing.orders.pack");
  }
  const plan = item.planKey ? (names[item.planKey] ?? item.planKey) : t("billing.orders.plan");
  const period = item.months ? ` · ${periodLabel(item.months)}` : "";
  return item.kind === "upgrade"
    ? `${t("billing.receipt.upgradeTo", { plan })}${period}`
    : `${plan}${period}`;
}

function receiptLines(receipt: ReceiptView, item: string): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  receipt.lines.forEach((line, index) => {
    // Tax and fee are itemised in the totals; bonus lines carry no amount of their own.
    if (line.kind === "tax" || line.kind === "fee" || line.kind === "bonus") return;
    lines.push({
      key: `${line.kind}-${String(index)}`,
      label: line.kind === "plan" ? item : lineLabel(line.labelKey),
      amountMinor: line.amountMinor,
    });
  });
  return lines;
}

function receiptTotals(receipt: ReceiptView): ReceiptTotal[] {
  const { totals } = receipt;
  const rows: ReceiptTotal[] = [
    { key: "subtotal", label: t("billing.receipt.subtotal"), amountMinor: totals.subtotalMinor },
  ];
  if (totals.taxMinor > 0) {
    rows.push({
      key: "tax",
      label:
        receipt.taxMode === "inclusive"
          ? t("billing.receipt.taxIncluded")
          : t("billing.receipt.taxAdded"),
      amountMinor: totals.taxMinor,
    });
  }
  if (totals.feeMinor > 0) {
    rows.push({ key: "fee", label: t("billing.fee.method"), amountMinor: totals.feeMinor });
  }
  rows.push({
    key: "total",
    label: t("billing.receipt.total"),
    amountMinor: totals.totalMinor,
    strong: true,
  });
  if (totals.refundedMinor > 0) {
    rows.push(
      { key: "refunded", label: t("billing.receipt.refunded"), amountMinor: -totals.refundedMinor },
      {
        key: "net",
        label: t("billing.receipt.netPaid"),
        amountMinor: totals.netPaidMinor,
        strong: true,
      },
    );
  }
  return rows;
}

/** The printable receipt of one paid order: buyer, seller, the full itemisation (BILLING §6.4). */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireOnboarded(`/billing/orders/${id}/receipt`);
  const parsed = orderIdParamSchema.safeParse({ id });

  let receipt: ReceiptView | null = null;
  if (parsed.success) {
    try {
      receipt = await serverApi(`/me/orders/${parsed.data.id}/receipt`, { schema: receiptSchema });
    } catch (error) {
      if (!(error instanceof ApiRequestError && error.code === "NOT_FOUND")) throw error;
    }
  }
  if (!receipt) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-bold text-primary">
          {t("billing.receipt.title")}
        </h1>
        <Notice tone="warning">{t("billing.receipt.notFound")}</Notice>
        <Link href="/billing" className={buttonStyles({ className: "self-start" })}>
          {t("billing.order.toBilling")}
        </Link>
      </div>
    );
  }

  const catalog = await getCatalog(receipt.currency);
  const names: Record<string, string> = {};
  for (const plan of catalog?.plans ?? []) names[plan.key] = plan.names.ar;
  for (const pack of catalog?.creditPacks ?? []) names[pack.key] = pack.names.ar;

  const item = itemText(receipt, names);
  const seller: ReceiptParty = {
    heading: t("billing.receipt.seller"),
    lines: [
      receipt.company.legalName ?? t("brand.name"),
      ...(receipt.company.address ? [receipt.company.address] : []),
      ...(receipt.company.taxId ? [t("billing.receipt.taxId", { id: receipt.company.taxId })] : []),
    ],
  };
  const buyer: ReceiptParty = {
    heading: t("billing.receipt.buyer"),
    lines: [
      receipt.buyer.name,
      ...(receipt.buyer.email ? [receipt.buyer.email] : []),
      ...(receipt.buyer.phone ? [receipt.buyer.phone] : []),
    ],
  };
  const meta = [
    { key: "issued", label: t("billing.receipt.issued"), value: formatDate(receipt.issuedAt) },
    ...(receipt.paidAt
      ? [{ key: "paid", label: t("billing.receipt.paidAt"), value: formatDate(receipt.paidAt) }]
      : []),
    {
      key: "status",
      label: t("billing.receipt.status"),
      value:
        receipt.status === "paid"
          ? t("billing.orders.status.paid")
          : receipt.status === "refunded"
            ? t("billing.orders.status.refunded")
            : t("billing.orders.status.partially_refunded"),
    },
    ...(receipt.payment
      ? [
          {
            key: "method",
            label: t("billing.receipt.method"),
            value: `${receipt.payment.methodNameAr} · ${receipt.payment.reference}`,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/billing" className={buttonStyles({ variant: "ghost" })}>
          {t("billing.order.toBilling")}
        </Link>
        <PrintButton />
      </div>
      <ReceiptSheet
        currency={receipt.currency}
        title={t("billing.receipt.title")}
        number={receipt.number}
        meta={meta}
        parties={[seller, buyer]}
        itemLabel={item}
        lines={receiptLines(receipt, item)}
        totals={receiptTotals(receipt)}
        notes={receipt.taxMode === "inclusive" ? [t("billing.tax.inclusive")] : []}
      />
    </div>
  );
}
