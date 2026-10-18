import { orderIdParamSchema } from "@wasfa/shared/schemas/billing";
import { redirect } from "next/navigation";

import { requireOnboarded } from "../../../../../../lib/session";

/**
 * The URL the payment gateway sends the customer back to (`${WEB_ORIGIN}/billing/orders/<id>`).
 * It only forwards to the checkout page, which reads the order and waits for the webhook.
 */
export default async function GatewayReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireOnboarded(`/billing/orders/${id}`);
  const parsed = orderIdParamSchema.safeParse({ id });
  redirect(parsed.success ? `/checkout/${parsed.data.id}` : "/billing");
}
