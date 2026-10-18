import { t } from "@wasfa/shared/i18n";
import { orderIdParamSchema, orderStatusResponseSchema } from "@wasfa/shared/schemas/billing";
import { buttonStyles } from "@wasfa/ui";
import Link from "next/link";

import { OrderFlow } from "../../../../../components/billing/order-flow";
import { Notice } from "../../../../../components/notice";
import { ApiRequestError } from "../../../../../lib/api-error";
import { getCatalog } from "../../../../../lib/billing-server";
import { contactLinks } from "../../../../../lib/contact-links";
import { getPublicSettings } from "../../../../../lib/public-settings";
import { requireOnboarded, serverApi } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("billing.order.title") };

function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold text-primary">{t("billing.order.title")}</h1>
      <Notice tone="warning">{t("billing.order.notFound")}</Notice>
      <Link
        href="/billing"
        className={buttonStyles({ variant: "secondary", className: "self-start" })}
      >
        {t("billing.order.toBilling")}
      </Link>
    </div>
  );
}

/**
 * Where checkout lands after Pay: the gateway's return URL (through `/billing/orders/<id>`), the
 * manual-transfer instructions and the free-order success all show here. The first read is done on
 * the server so the state is in the first response.
 */
export default async function CheckoutOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  await requireOnboarded(`/checkout/${orderId}`);
  const parsed = orderIdParamSchema.safeParse({ id: orderId });
  if (!parsed.success) return <NotFound />;

  let order;
  try {
    order = await serverApi(`/billing/orders/${parsed.data.id}`, {
      schema: orderStatusResponseSchema,
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.code === "NOT_FOUND") return <NotFound />;
    throw error;
  }

  const [catalog, settings] = await Promise.all([getCatalog(order.currency), getPublicSettings()]);
  const supportHref = contactLinks(settings.contact).find(
    (link) => link.channel === "whatsapp",
  )?.href;

  return (
    <OrderFlow
      initial={order}
      methods={(catalog?.methods ?? []).map((method) => ({ key: method.key, kind: method.kind }))}
      supportHref={supportHref ?? null}
    />
  );
}
