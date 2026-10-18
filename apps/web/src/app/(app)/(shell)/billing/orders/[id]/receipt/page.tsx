import { t } from "@wasfa/shared/i18n";
import { orderIdParamSchema } from "@wasfa/shared/schemas/billing";
import { buttonStyles } from "@wasfa/ui";
import Link from "next/link";

import { ReceiptDocument } from "../../../../../../../components/billing/receipt-document";
import { Notice } from "../../../../../../../components/notice";
import { ApiRequestError } from "../../../../../../../lib/api-error";
import { receiptSchema, type ReceiptView } from "../../../../../../../lib/billing-schemas";
import { requireOnboarded, serverApi } from "../../../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("billing.receipt.title") };

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
  return (
    <ReceiptDocument
      receipt={receipt}
      backHref="/billing"
      backLabel={t("billing.order.toBilling")}
    />
  );
}
