import { t } from "@wasfa/shared/i18n";
import { orderIdParamSchema } from "@wasfa/shared/schemas/billing";
import { orgContextIdSchema } from "@wasfa/shared/schemas/org";
import { buttonStyles } from "@wasfa/ui";
import Link from "next/link";

import { ReceiptDocument } from "../../../../../../../../components/billing/receipt-document";
import { Notice } from "../../../../../../../../components/notice";
import { ApiRequestError } from "../../../../../../../../lib/api-error";
import { receiptSchema, type ReceiptView } from "../../../../../../../../lib/billing-schemas";
import { requireOnboarded, serverApi } from "../../../../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("billing.receipt.title") };

/** The printable receipt of one paid order of an organization (org admins only; the API checks). */
export default async function OrgReceiptPage({
  params,
}: {
  params: Promise<{ orgId: string; id: string }>;
}) {
  const { orgId, id } = await params;
  await requireOnboarded(`/org/${orgId}/orders/${id}/receipt`);
  const org = orgContextIdSchema.safeParse(orgId);
  const order = orderIdParamSchema.safeParse({ id });

  let receipt: ReceiptView | null = null;
  if (org.success && order.success) {
    try {
      receipt = await serverApi(`/orgs/${org.data}/orders/${order.data.id}/receipt`, {
        schema: receiptSchema,
      });
    } catch (error) {
      const refused =
        error instanceof ApiRequestError &&
        (error.code === "NOT_FOUND" || error.code === "FORBIDDEN");
      if (!refused) throw error;
    }
  }
  const back = `/org/${orgId}`;
  if (!receipt) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-bold text-primary">
          {t("billing.receipt.title")}
        </h1>
        <Notice tone="warning">{t("billing.receipt.notFound")}</Notice>
        <Link href={back} className={buttonStyles({ className: "self-start" })}>
          {t("org.receipt.back")}
        </Link>
      </div>
    );
  }
  return <ReceiptDocument receipt={receipt} backHref={back} backLabel={t("org.receipt.back")} />;
}
