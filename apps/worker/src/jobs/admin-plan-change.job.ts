import {
  organizationMembers,
  plans,
  subscriptions,
  userNotifications,
  users,
  type OutboxHandler,
  type OutboxPostCommitAction,
} from "@wasfa/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { jobIdFor } from "../notifications/customer-channel.js";

const payloadSchema = z.object({ subscriptionId: z.uuid(), kind: z.string().max(40) });

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/**
 * `subscriptions.admin_notice` (Task 3.15): an admin gave a plan (gift, compensation, trial,
 * sponsored) and left "notify the user" on. The API already wrote the personal bell notification in
 * the same transaction; this adds the bell of an organization's admins and the customer message
 * (WhatsApp, with the channel rules of `customer.notify`). Paid-offline changes need no entry here:
 * they ride the ordinary `billing.order_paid` receipt.
 */
export function adminPlanChangeOutboxHandlers(): Record<string, OutboxHandler> {
  return {
    "subscriptions.admin_notice": async (tx, entry) => {
      const { subscriptionId, kind } = payloadSchema.parse(entry.payload);
      const [row] = await tx
        .select({ subscription: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.id, subscriptionId));
      if (!row) return;
      const { subscription, plan } = row;
      const isOrg = subscription.ownerUserId === null;
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
        .select({ id: users.id, locale: users.locale, status: users.status })
        .from(users)
        .where(inArray(users.id, recipientIds));
      const actions: OutboxPostCommitAction[] = [];
      for (const recipient of recipients) {
        if (recipient.status !== "active") continue;
        if (isOrg) {
          await tx.insert(userNotifications).values({
            userId: recipient.id,
            kind: "subscription.admin_changed",
            params: { planKey: plan.key, changeKind: kind },
            link: "/billing",
          });
        }
        const key = `admin_notice:${subscription.id}:${String(subscription.createdAt.getTime())}:${recipient.id}`;
        actions.push({
          kind: "customer_message",
          payload: {
            key,
            userId: recipient.id,
            kind: "subscription_activated",
            params: {
              plan: recipient.locale === "en" ? plan.nameEn : plan.nameAr,
              date: dayOf(subscription.currentPeriodEnd),
              credits: plan.monthlyCredits,
              // No order behind a gift: the template's order number reads as a dash.
              number: "-",
            },
            path: "/billing",
          },
          jobId: jobIdFor("customer", key),
        });
      }
      return actions;
    },
  };
}
