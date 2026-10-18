import { Inject, Injectable } from "@nestjs/common";
import {
  creditWallets,
  orders,
  organizations,
  planEntitlements,
  plans,
  subscriptionEvents,
  subscriptions,
  users,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import { and, asc, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

import type { SubscriptionListQuery } from "@wasfa/shared/schemas/admin-billing-console";

const DAY_MS = 86_400_000;

@Injectable()
export class AdminBillingSubscriptionsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  list(query: SubscriptionListQuery, cursor: Cursor | undefined, now: Date) {
    const conditions: Array<SQL | undefined> = [
      query.status ? eq(subscriptions.status, query.status) : undefined,
      query.source ? eq(subscriptions.source, query.source) : undefined,
      query.planKey ? eq(plans.key, query.planKey) : undefined,
      // "Expiring" only makes sense for a subscription that still gives access.
      query.expiringWithinDays
        ? and(
            inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
            gte(subscriptions.currentPeriodEnd, now),
            lte(
              subscriptions.currentPeriodEnd,
              new Date(now.getTime() + query.expiringWithinDays * DAY_MS),
            ),
          )
        : undefined,
      cursor ? afterCursor(subscriptions.createdAt, subscriptions.id, cursor, "uuid") : undefined,
    ];
    return this.handle.db
      .select({
        subscription: subscriptions,
        planKey: plans.key,
        userName: users.name,
        orgName: organizations.name,
        at: stamp(subscriptions.createdAt),
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(users, eq(users.id, subscriptions.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, subscriptions.ownerOrgId))
      .where(and(...conditions))
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .limit(query.limit + 1);
  }

  async detail(id: string) {
    const [row] = await this.handle.db
      .select({
        subscription: subscriptions,
        plan: plans,
        userName: users.name,
        orgName: organizations.name,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(users, eq(users.id, subscriptions.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, subscriptions.ownerOrgId))
      .where(eq(subscriptions.id, id));
    if (!row) return null;

    const { ownerUserId, ownerOrgId } = row.subscription;
    const ownerOrders = ownerUserId
      ? eq(orders.ownerUserId, ownerUserId)
      : eq(orders.ownerOrgId, ownerOrgId ?? "");
    const ownerWallet = ownerUserId
      ? eq(creditWallets.ownerUserId, ownerUserId)
      : eq(creditWallets.ownerOrgId, ownerOrgId ?? "");
    const [events, entitlements, wallet, recentOrders] = await Promise.all([
      this.handle.db
        .select({
          id: subscriptionEvents.id,
          type: subscriptionEvents.type,
          data: subscriptionEvents.data,
          actorId: subscriptionEvents.actorId,
          createdAt: subscriptionEvents.createdAt,
        })
        .from(subscriptionEvents)
        .where(eq(subscriptionEvents.subscriptionId, id))
        .orderBy(asc(subscriptionEvents.createdAt), asc(subscriptionEvents.id)),
      this.handle.db
        .select()
        .from(planEntitlements)
        .where(eq(planEntitlements.planId, row.plan.id))
        .orderBy(asc(planEntitlements.task)),
      this.handle.db
        .select({ balance: creditWallets.balance })
        .from(creditWallets)
        .where(ownerWallet),
      this.handle.db
        .select({
          id: orders.id,
          number: orders.number,
          kind: orders.kind,
          status: orders.status,
          totalMinor: orders.totalMinor,
          currency: orders.currency,
          createdAt: orders.createdAt,
          paidAt: orders.paidAt,
        })
        .from(orders)
        .where(ownerOrders)
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(20),
    ]);
    return { ...row, events, entitlements, creditBalance: wallet[0]?.balance ?? 0, recentOrders };
  }
}
