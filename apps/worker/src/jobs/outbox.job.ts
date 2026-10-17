import {
  OUTBOX_MAX_FAST_ATTEMPTS,
  drainOutbox,
  adminRecipients,
  orders,
  userNotifications,
  users,
  adminAlerts,
  adminAlertPrefs,
  alertDeliveries,
  payments,
  organizationMembers,
  plans,
  subscriptions,
  type OutboxHandler,
} from "@wasfa/db";
import { ALERT_CHANNELS } from "@wasfa/shared/billing";
import { ALERT_KIND_PERMISSION } from "@wasfa/shared/permissions";
import { SUBSCRIPTION_REMINDER_SLOTS } from "@wasfa/shared/subscriptions";
import { and, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import type { PaymentsRuntime } from "../payments/runtime.js";
import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

const orderPayload = z.object({ orderId: z.uuid() });
const refundPayload = z.object({ orderId: z.uuid(), refundId: z.uuid() });
const paymentPayload = z.object({ paymentId: z.uuid() });
const reminderPayload = z.object({
  subscriptionId: z.uuid(),
  slot: z.enum(SUBSCRIPTION_REMINDER_SLOTS),
});

/** The outbox topics this worker knows. A topic without a handler is parked, never dropped. */
export function outboxHandlers(
  runtime: Pick<
    PaymentsRuntime,
    "enqueueEmail" | "webOrigin" | "enqueueAlertDelivery" | "enqueueAlertDigest"
  >,
): Record<string, OutboxHandler> {
  return {
    "alerts.fan_out": async (tx, entry) => {
      const { alertId } = z.object({ alertId: z.uuid() }).parse(entry.payload);
      const [alert] = await tx.select().from(adminAlerts).where(eq(adminAlerts.id, alertId));
      if (!alert) return;
      const needed = ALERT_KIND_PERMISSION[alert.kind];
      const recipients = await adminRecipients(tx, needed);
      const postCommit = [];
      for (const user of recipients) {
        const [prefs] = await tx
          .select()
          .from(adminAlertPrefs)
          .where(eq(adminAlertPrefs.userId, user.id));
        if (alert.severity !== "critical" && prefs?.mutedKinds.includes(alert.kind)) continue;
        const channels = {
          in_app: prefs?.inAppEnabled ?? true,
          email: prefs?.emailEnabled ?? true,
          telegram: prefs?.telegramEnabled ?? true,
          whatsapp: prefs?.whatsappEnabled ?? false,
        };
        for (const channel of ALERT_CHANNELS) {
          if (!channels[channel]) continue;
          const [delivery] = await tx
            .insert(alertDeliveries)
            .values({
              alertId,
              adminUserId: user.id,
              channel,
              status: channel === "in_app" ? "sent" : "pending",
              sentAt: channel === "in_app" ? new Date() : null,
            })
            .onConflictDoNothing()
            .returning({ id: alertDeliveries.id });
          if (delivery && channel !== "in_app") {
            const now = new Date();
            const activeWindow =
              alert.severity === "critical"
                ? undefined
                : (
                    await tx
                      .select({
                        createdAt: alertDeliveries.createdAt,
                        sentAt: alertDeliveries.sentAt,
                      })
                      .from(alertDeliveries)
                      .where(
                        and(
                          eq(alertDeliveries.adminUserId, user.id),
                          eq(alertDeliveries.channel, channel),
                          ne(alertDeliveries.id, delivery.id),
                          inArray(alertDeliveries.status, ["sent", "pending"]),
                          isNull(alertDeliveries.error),
                          gte(alertDeliveries.createdAt, new Date(now.getTime() - 10 * 60_000)),
                        ),
                      )
                      .orderBy(desc(alertDeliveries.createdAt))
                      .limit(1)
                  )[0];
            const windowStart = activeWindow?.sentAt ?? activeWindow?.createdAt;
            if (windowStart) {
              await tx
                .update(alertDeliveries)
                .set({ error: "digest_pending" })
                .where(eq(alertDeliveries.id, delivery.id));
              postCommit.push({
                kind: "alert_digest" as const,
                adminUserId: user.id,
                channel,
                windowStart: windowStart.toISOString(),
                delayMs: windowStart.getTime() + 10 * 60_000 - now.getTime(),
              });
            } else {
              postCommit.push({
                kind: "alert_delivery" as const,
                deliveryId: delivery.id,
                jobId: `alert-delivery:${delivery.id}`,
              });
            }
          }
        }
      }
      return postCommit;
    },
    "billing.payment_rejected": async (tx, entry) => {
      const { paymentId } = paymentPayload.parse(entry.payload);
      const [row] = await tx
        .select({ payment: payments, order: orders, owner: users })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .innerJoin(users, eq(users.id, orders.ownerUserId))
        .where(eq(payments.id, paymentId));
      if (!row?.order.ownerUserId) return;
      await tx.insert(userNotifications).values({
        userId: row.order.ownerUserId,
        kind: "billing.payment_rejected",
        params: {
          orderNumber: row.order.number,
          reason: row.payment.rejectReason ?? "other",
          note: row.payment.reviewNote,
        },
        link: `/billing/orders/${row.order.id}`,
      });
      if (row.owner.status === "active") {
        await runtime.enqueueEmail(
          {
            template: "billing_payment_rejected",
            to: row.owner.email,
            name: row.owner.name,
            locale: row.owner.locale,
            orderNumber: row.order.number,
            reason: row.payment.rejectReason ?? "other",
            note: row.payment.reviewNote,
            link: `${runtime.webOrigin}/billing/orders/${row.order.id}`,
          },
          `outbox-${entry.id}`,
        );
      }
    },
    "billing.payment_resubmit": async (tx, entry) => {
      const { paymentId } = paymentPayload.parse(entry.payload);
      const [row] = await tx
        .select({ payment: payments, order: orders, owner: users })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .innerJoin(users, eq(users.id, orders.ownerUserId))
        .where(eq(payments.id, paymentId));
      if (!row?.order.ownerUserId) return;
      await tx.insert(userNotifications).values({
        userId: row.order.ownerUserId,
        kind: "billing.payment_resubmit",
        params: { orderNumber: row.order.number, note: row.payment.reviewNote },
        link: `/billing/orders/${row.order.id}`,
      });
      if (row.owner.status === "active") {
        await runtime.enqueueEmail(
          {
            template: "billing_payment_resubmit",
            to: row.owner.email,
            name: row.owner.name,
            locale: row.owner.locale,
            orderNumber: row.order.number,
            note: row.payment.reviewNote,
            link: `${runtime.webOrigin}/billing/orders/${row.order.id}`,
          },
          `outbox-${entry.id}`,
        );
      }
    },
    /**
     * BILLING §7.2: 7/3/1 days before the end, during grace, and at expiry, with the one-tap renew
     * link. An organization's subscription reminds its admins.
     */
    "subscriptions.reminder": async (tx, entry) => {
      const { subscriptionId, slot } = reminderPayload.parse(entry.payload);
      const [row] = await tx
        .select({ subscription: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.id, subscriptionId));
      if (!row) return;
      const { subscription, plan } = row;
      const recipientIds = subscription.ownerUserId
        ? [subscription.ownerUserId]
        : subscription.ownerOrgId
          ? (
              await tx
                .select({ userId: organizationMembers.userId })
                .from(organizationMembers)
                .where(
                  and(
                    eq(organizationMembers.orgId, subscription.ownerOrgId),
                    eq(organizationMembers.role, "org_admin"),
                  ),
                )
            ).map((member) => member.userId)
          : [];
      if (recipientIds.length === 0) return;
      const recipients = await tx
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          locale: users.locale,
          status: users.status,
        })
        .from(users)
        .where(inArray(users.id, recipientIds));
      const path = `/billing/renew?sub=${subscription.id}`;
      for (const recipient of recipients) {
        if (recipient.status !== "active") continue;
        await tx.insert(userNotifications).values({
          userId: recipient.id,
          kind: "billing.subscription_reminder",
          params: {
            slot,
            planKey: plan.key,
            endsAt: subscription.currentPeriodEnd.toISOString(),
          },
          link: path,
        });
        await runtime.enqueueEmail(
          {
            template: "subscription_reminder",
            to: recipient.email,
            name: recipient.name,
            locale: recipient.locale,
            slot,
            planName: recipient.locale === "en" ? plan.nameEn : plan.nameAr,
            endsAt: subscription.currentPeriodEnd.toISOString(),
            link: `${runtime.webOrigin}${path}`,
          },
          `outbox-${entry.id}-${recipient.id}`,
        );
      }
    },
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
  const result = await drainOutbox(db, outboxHandlers(payments), new Date(), 50, async (action) => {
    if (action.kind === "alert_delivery") {
      await payments.enqueueAlertDelivery(action.deliveryId, action.jobId);
    } else {
      await payments.enqueueAlertDigest(
        {
          adminUserId: action.adminUserId,
          channel: action.channel,
          windowStart: action.windowStart,
        },
        action.delayMs,
      );
    }
  });
  if (result.failed > 0 || result.parked > 0) {
    logger.warn(
      { event: "outbox.retry", ...result, maxFastAttempts: OUTBOX_MAX_FAST_ATTEMPTS },
      "Outbox entries will be retried",
    );
  } else if (result.processed > 0) {
    logger.info(result, "Outbox drained");
  }
}
