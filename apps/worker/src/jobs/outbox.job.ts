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
  refunds,
  type OutboxHandler,
  type OutboxPostCommitAction,
  dealRewardOverrides,
  type RewardEvaluationOptions,
  silenceMarketing,
} from "@wasfa/db";
import { ALERT_CHANNELS } from "@wasfa/shared/billing";
import { decodeEncryptionKey, decryptSecret } from "@wasfa/shared/crypto";
import { type CustomerMessageInput } from "@wasfa/shared/customer-messages";
import { MARKETING_SILENCE_AFTER_COMPLAINT_DAYS } from "@wasfa/shared/growth";
import { formatMoney } from "@wasfa/shared/money";
import { ALERT_KIND_PERMISSION } from "@wasfa/shared/permissions";
import { CONTENT_CHANGED_TOPIC } from "@wasfa/shared/schemas/content";
import { SUBSCRIPTION_REMINDER_SLOTS } from "@wasfa/shared/subscriptions";
import { and, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { contentChangeHandler, type ContentChangeDeps } from "../content/change-handler.js";
import { jobIdFor } from "../notifications/customer-channel.js";
import { readSetting } from "../settings.js";

import { adminPlanChangeOutboxHandlers } from "./admin-plan-change.job.js";
import { rewardOutboxHandlers } from "./rewards.job.js";
import { withdrawalOutboxHandlers } from "./withdrawals.job.js";

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

/** A customer notification, queued after the outbox transaction commits. */
function customerMessage(payload: CustomerMessageInput): OutboxPostCommitAction {
  return { kind: "customer_message", payload, jobId: jobIdFor("customer", payload.key) };
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/** The outbox topics this worker knows. A topic without a handler is parked, never dropped. */
export function outboxHandlers(
  runtime: Pick<
    PaymentsRuntime,
    "enqueueEmail" | "webOrigin" | "enqueueAlertDelivery" | "enqueueAlertDigest"
  >,
  rewards: RewardEvaluationOptions = { deals: dealRewardOverrides },
  content?: ContentChangeDeps,
): Record<string, OutboxHandler> {
  return {
    // Without deps (tests, no runtime) the topic stays parked, never dropped.
    ...(content ? { [CONTENT_CHANGED_TOPIC]: contentChangeHandler(content) } : {}),
    "alerts.fan_out": async (tx, entry) => {
      const { alertId } = z.object({ alertId: z.uuid() }).parse(entry.payload);
      const [alert] = await tx.select().from(adminAlerts).where(eq(adminAlerts.id, alertId));
      if (!alert) return;
      const needed = ALERT_KIND_PERMISSION[alert.kind];
      // A test alert goes to the admin who asked for it (`refId`), and only if they still may receive alerts.
      const isTest = alert.kind === "system.test";
      const recipients = (await adminRecipients(tx, needed)).filter(
        (user) => !isTest || user.id === alert.refId,
      );
      const postCommit = [];
      for (const user of recipients) {
        const [prefs] = await tx
          .select()
          .from(adminAlertPrefs)
          .where(eq(adminAlertPrefs.userId, user.id));
        if (alert.severity !== "critical" && !isTest && prefs?.mutedKinds.includes(alert.kind))
          continue;
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
            // Critical alerts and tests are never held back for the 10-minute digest.
            const activeWindow =
              alert.severity === "critical" || isTest
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
      if (row.owner.status !== "active") return;
      const path = `/billing/orders/${row.order.id}`;
      return [
        customerMessage({
          key: `payment_rejected:${paymentId}:${String(row.payment.proofSubmissions)}`,
          userId: row.owner.id,
          kind: "payment_rejected",
          params: {
            number: row.order.number,
            reason: row.payment.rejectReason ?? "other",
            ...(row.payment.reviewNote ? { note: row.payment.reviewNote } : {}),
          },
          path,
          email: {
            template: "billing_payment_rejected",
            to: row.owner.email,
            name: row.owner.name,
            locale: row.owner.locale,
            orderNumber: row.order.number,
            reason: row.payment.rejectReason ?? "other",
            note: row.payment.reviewNote,
            link: `${runtime.webOrigin}${path}`,
          },
        }),
      ];
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
      if (row.owner.status !== "active") return;
      const path = `/billing/orders/${row.order.id}`;
      return [
        customerMessage({
          key: `payment_resubmit:${paymentId}:${String(row.payment.proofSubmissions)}`,
          userId: row.owner.id,
          kind: "payment_resubmit",
          params: {
            number: row.order.number,
            ...(row.payment.reviewNote ? { note: row.payment.reviewNote } : {}),
          },
          path,
          email: {
            template: "billing_payment_resubmit",
            to: row.owner.email,
            name: row.owner.name,
            locale: row.owner.locale,
            orderNumber: row.order.number,
            note: row.payment.reviewNote,
            link: `${runtime.webOrigin}${path}`,
          },
        }),
      ];
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
                    eq(organizationMembers.status, "active"),
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
      const actions: OutboxPostCommitAction[] = [];
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
        const planName = recipient.locale === "en" ? plan.nameEn : plan.nameAr;
        actions.push(
          customerMessage({
            key: `sub_reminder:${subscription.id}:${String(subscription.currentPeriodEnd.getTime())}:${slot}:${recipient.id}`,
            userId: recipient.id,
            kind: "subscription_reminder",
            params: { plan: planName, date: dayOf(subscription.currentPeriodEnd), slot },
            path,
            email: {
              template: "subscription_reminder",
              to: recipient.email,
              name: recipient.name,
              locale: recipient.locale,
              slot,
              planName,
              endsAt: subscription.currentPeriodEnd.toISOString(),
              link: `${runtime.webOrigin}${path}`,
            },
          }),
        );
      }
      return actions;
    },
    /** BILLING §5.3 step 6: in-app notification and the receipt mail. */
    "billing.order_paid": async (tx, entry) => {
      const { orderId } = orderPayload.parse(entry.payload);
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
      if (!order?.ownerUserId) return; // An organization order's receipt is read in its dashboard.
      const [owner] = await tx
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          locale: users.locale,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, order.ownerUserId));
      const path = `/billing/orders/${order.id}`;
      const link = `${runtime.webOrigin}${path}`;
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
      // A subscription order says what was activated; a credit pack, what was paid.
      const [period] =
        order.kind === "credit_pack"
          ? []
          : await tx
              .select({ subscription: subscriptions, plan: plans })
              .from(subscriptions)
              .innerJoin(plans, eq(plans.id, subscriptions.planId))
              .where(eq(subscriptions.lastOrderId, order.id))
              .limit(1);
      const total = formatMoney(order.totalMinor, order.currency, owner.locale);
      return [
        customerMessage({
          key: `order_paid:${order.id}`,
          userId: owner.id,
          kind: period ? "subscription_activated" : "payment_received",
          params: period
            ? {
                plan: owner.locale === "en" ? period.plan.nameEn : period.plan.nameAr,
                date: dayOf(period.subscription.currentPeriodEnd),
                credits: period.plan.monthlyCredits,
                number: order.number,
              }
            : { number: order.number, total },
          path,
          // The receipt is a document: it is mailed whether or not WhatsApp also gets a message.
          emailAlways: true,
          email: {
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
        }),
      ];
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
      // No marketing for 30 days after a refund (GROWTH §6): an offer now would be tone-deaf.
      await silenceMarketing(tx, order.ownerUserId, MARKETING_SILENCE_AFTER_COMPLAINT_DAYS);
      const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
      const [owner] = await tx
        .select({ locale: users.locale })
        .from(users)
        .where(eq(users.id, order.ownerUserId));
      if (!refund || !owner) return;
      return [
        customerMessage({
          key: `order_refunded:${refundId}`,
          userId: order.ownerUserId,
          kind: "order_refunded",
          params: {
            number: order.number,
            amount: formatMoney(refund.amountMinor, refund.currency, owner.locale),
          },
          path: `/billing/orders/${order.id}`,
        }),
      ];
    },
    // Referral rewards (Task 3.11): sign-up checks, paid and refunded orders, and `orgs.member_joined`
    // (a person joined an organization through a join link or an approved request).
    ...rewardOutboxHandlers(rewards),
    // Customer notices of withdrawal steps and new payout destinations (Task 3.12).
    ...withdrawalOutboxHandlers(runtime),
    // Customer notice of an admin plan change (gift, compensation, trial, sponsored; Task 3.15).
    ...adminPlanChangeOutboxHandlers(),
  };
}

type OutboxContext = Pick<JobContext, "db" | "logger" | "payments" | "env">;

/** Opens the sealed sender number of a manual payment for the same-payer fraud check. */
function senderPhoneOpener(env: JobContext["env"]): RewardEvaluationOptions["openSenderPhone"] {
  if (env === undefined) return undefined;
  const key = decodeEncryptionKey(env.ENCRYPTION_KEY);
  return (sealed, paymentId) => {
    try {
      return decryptSecret(sealed, key, `payment.sender_phone:${paymentId}`);
    } catch {
      return null;
    }
  };
}

/** `outbox.drain`, every 30 seconds. */
export async function drainOutboxJob(
  _payload: JobPayload<"payments", "outbox.drain">,
  { db, logger, payments, env }: OutboxContext,
): Promise<void> {
  if (!payments) {
    logger.warn({ event: "payments.runtime_missing" }, "Outbox drain skipped");
    return;
  }
  const handlers = outboxHandlers(
    payments,
    { deals: dealRewardOverrides, openSenderPhone: senderPhoneOpener(env) },
    {
      logger,
      webInternalUrl: env?.WEB_INTERNAL_URL,
      revalidateSecret: env?.REVALIDATE_SECRET,
      webOrigin: payments.webOrigin,
      indexNowSettings: async () => (await readSetting(db, "seo")).indexNow,
      enqueueIndexNow: (urls) => payments.enqueueIndexNow(urls),
    },
  );
  const result = await drainOutbox(db, handlers, new Date(), 50, async (action) => {
    if (action.kind === "alert_delivery") {
      await payments.enqueueAlertDelivery(action.deliveryId, action.jobId);
    } else if (action.kind === "customer_message") {
      await payments.enqueueCustomerMessage(action.payload, action.jobId);
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
