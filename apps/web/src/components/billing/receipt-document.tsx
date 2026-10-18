import { t } from "@wasfa/shared/i18n";
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

import { getCatalog } from "../../lib/billing-server";
import { formatDate } from "../../lib/dates";

import { PrintButton } from "./print-button";

import type { ReceiptView } from "../../lib/billing-schemas";

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

export interface ReceiptDocumentProps {
  receipt: ReceiptView;
  /** Where the toolbar's back link goes (the billing account, or the organization's orders). */
  backHref: string;
  backLabel: string;
}

/** The printable receipt of one paid order: buyer, seller, the full itemisation (BILLING §6.4). */
export async function ReceiptDocument({ receipt, backHref, backLabel }: ReceiptDocumentProps) {
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
        <Link href={backHref} className={buttonStyles({ variant: "ghost" })}>
          {backLabel}
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
