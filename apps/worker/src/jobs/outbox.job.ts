import {
  OUTBOX_MAX_FAST_ATTEMPTS,
  drainOutbox,
  orders,
  userNotifications,
  users,
  type OutboxHandler,
} from "@wasfa/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { PaymentsRuntime } from "../payments/runtime.js";
import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

const orderPayload = z.object({ orderId: z.uuid() });
const refundPayload = z.object({ orderId: z.uuid(), refundId: z.uuid() });

/** The outbox topics this worker knows. A topic without a handler is parked, never dropped. */
export function outboxHandlers(
  runtime: Pick<PaymentsRuntime, "enqueueEmail" | "webOrigin">,
): Record<string, OutboxHandler> {
  return {
    /** BILLING §5.3 step 6: in-app notification and the receipt mail. */
    "billing.order_paid": async (tx, entry) => {
      const { orderId } = orderPayload.parse(entry.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order?.ownerUserId) return; // Organization receipts arrive with WP6.
      const [owner] = await tx
        .select({
          email: users.email,
          name: users.name,
          locale: users.locale,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, order.ownerUserId));
      const link = `${runtime.webOrigin}/billing/orders/${order.id}`;
      await tx.insert(userNotifications).values({
        userId: order.ownerUserId,
        kind: "billing.order_paid",
        params: {
          orderNumber: order.number,
          totalMinor: order.totalMinor,
          currency: order.currency,
        },
        link: `/billing/orders/${order.id}`,
      });
      if (!owner || owner.status === "deleted") return;
      await runtime.enqueueEmail(
        {
          template: "payment_receipt",
          to: owner.email,
          name: owner.name,
          locale: owner.locale,
          orderNumber: order.number,
          totalMinor: order.totalMinor,
          currency: order.currency,
          taxAndFeesMinor: order.taxMinor + order.feeMinor,
          link,
        },
        `outbox-${entry.id}`,
      );
    },
    "billing.order_refunded": async (tx, entry) => {
      const { orderId, refundId } = refundPayload.parse(entry.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order?.ownerUserId) return;
      await tx.insert(userNotifications).values({
        userId: order.ownerUserId,
        kind: "billing.order_refunded",
        params: { orderNumber: order.number, refundId },
        link: `/billing/orders/${order.id}`,
      });
    },
  };
}

type OutboxContext = Pick<JobContext, "db" | "logger" | "payments">;

/** `outbox.drain`, every 30 seconds. */
export async function drainOutboxJob(
  _payload: JobPayload<"payments", "outbox.drain">,
  { db, logger, payments }: OutboxContext,
): Promise<void> {
  if (!payments) {
    logger.warn({ event: "payments.runtime_missing" }, "Outbox drain skipped");
    return;
  }
  const result = await drainOutbox(db, outboxHandlers(payments));
  if (result.failed > 0 || result.parked > 0) {
    logger.warn(
      { event: "outbox.retry", ...result, maxFastAttempts: OUTBOX_MAX_FAST_ATTEMPTS },
      "Outbox entries will be retried",
    );
  } else if (result.processed > 0) {
    logger.info(result, "Outbox drained");
  }
}
