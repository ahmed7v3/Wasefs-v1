import { t } from "@wasfa/shared/i18n";
import {
  lineLabel,
  periodLabel,
  type ReceiptLine,
  type ReceiptParty,
  type ReceiptTotal,
} from "@wasfa/ui";

import { formatDate } from "./dates";

import type { ReceiptPayload } from "./admin-billing-schemas";

/*
 * The receipt payload of an order (`GET /admin/billing/orders/:id`) shaped for `ReceiptSheet`, the
 * component customers print from. Only picks and labels the server's numbers; nothing is computed.
 */

export function receiptItemText(receipt: ReceiptPayload): string {
  const { item } = receipt;
  if (item.kind === "credit_pack") return item.packKey ?? t("billing.orders.pack");
  const plan = item.planKey ?? t("billing.orders.plan");
  const period = item.months ? ` · ${periodLabel(item.months)}` : "";
  return `${plan}${period}`;
}

export function receiptLines(receipt: ReceiptPayload, item: string): ReceiptLine[] {
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

export function receiptTotals(receipt: ReceiptPayload): ReceiptTotal[] {
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

export function receiptParties(receipt: ReceiptPayload): ReceiptParty[] {
  const { company, buyer } = receipt;
  return [
    {
      heading: t("billing.receipt.seller"),
      lines: [
        company.legalName ?? t("brand.name"),
        ...(company.address ? [company.address] : []),
        ...(company.taxId ? [t("billing.receipt.taxId", { id: company.taxId })] : []),
      ],
    },
    {
      heading: t("billing.receipt.buyer"),
      lines: [
        buyer.name,
        ...(buyer.email ? [buyer.email] : []),
        ...(buyer.phone ? [buyer.phone] : []),
      ],
    },
  ];
}

export function receiptMeta(receipt: ReceiptPayload) {
  return [
    { key: "issued", label: t("billing.receipt.issued"), value: formatDate(receipt.issuedAt) },
    ...(receipt.paidAt
      ? [{ key: "paid", label: t("billing.receipt.paidAt"), value: formatDate(receipt.paidAt) }]
      : []),
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
}
