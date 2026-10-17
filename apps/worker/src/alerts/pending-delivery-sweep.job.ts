import { alertDeliveries } from "@wasfa/db";
import { and, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

export async function pendingDeliverySweepJob(
  _payload: JobPayload<"notifications", "alerts.sweep_pending">,
  { db, payments }: JobContext,
  now = new Date(),
): Promise<void> {
  if (!payments) throw new Error("payments_runtime_missing");
  const cutoff = new Date(now.getTime() - 2 * 60_000);
  const pending = await db
    .select({ id: alertDeliveries.id })
    .from(alertDeliveries)
    .where(
      and(
        eq(alertDeliveries.status, "pending"),
        isNull(alertDeliveries.error),
        lt(alertDeliveries.createdAt, cutoff),
      ),
    )
    .limit(500);
  for (const delivery of pending) {
    await payments.enqueueAlertDelivery(delivery.id, `alert-delivery:${delivery.id}`);
  }

  const digestCutoff = new Date(now.getTime() - 12 * 60_000);
  const digests = await db
    .select({
      id: alertDeliveries.id,
      adminUserId: alertDeliveries.adminUserId,
      channel: alertDeliveries.channel,
      createdAt: alertDeliveries.createdAt,
    })
    .from(alertDeliveries)
    .where(
      and(
        eq(alertDeliveries.status, "pending"),
        eq(alertDeliveries.error, "digest_pending"),
        lt(alertDeliveries.createdAt, digestCutoff),
        inArray(alertDeliveries.channel, ["email", "telegram", "whatsapp"]),
      ),
    )
    .limit(500);

  for (const delivery of digests) {
    if (delivery.channel === "in_app") continue;
    const [anchor] = await db
      .select({ createdAt: alertDeliveries.createdAt, sentAt: alertDeliveries.sentAt })
      .from(alertDeliveries)
      .where(
        and(
          eq(alertDeliveries.adminUserId, delivery.adminUserId),
          eq(alertDeliveries.channel, delivery.channel),
          inArray(alertDeliveries.status, ["sent", "pending"]),
          isNull(alertDeliveries.error),
          gte(alertDeliveries.createdAt, new Date(delivery.createdAt.getTime() - 10 * 60_000)),
          lt(alertDeliveries.createdAt, delivery.createdAt),
        ),
      )
      .orderBy(desc(alertDeliveries.createdAt))
      .limit(1);
    if (!anchor) continue;
    const windowStart = anchor.sentAt ?? anchor.createdAt;
    if (windowStart.getTime() + 12 * 60_000 > now.getTime()) continue;
    await payments.enqueueAlertDigest(
      {
        adminUserId: delivery.adminUserId,
        channel: delivery.channel,
        windowStart: windowStart.toISOString(),
      },
      1,
    );
  }
}
