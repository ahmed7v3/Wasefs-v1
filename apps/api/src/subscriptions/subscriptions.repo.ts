import { Inject, Injectable } from "@nestjs/common";
import {
  cancelAtPeriodEnd,
  creditPacks,
  orders,
  paymentMethods,
  payments,
  plans,
  refunds,
  resume,
  startTrial,
  subscriptions,
  trialAvailable,
  users,
  type Order,
  type Plan,
  type Subscription,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import { and, desc, eq, inArray } from "drizzle-orm";

import { afterCursor, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";

const RECEIPT_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

export interface OrderListRow {
  order: Order;
  planKey: string | null;
  packKey: string | null;
  at: string;
}

/** The caller's subscription, orders and receipts. Every query is scoped to the caller's user id. */
@Injectable()
export class SubscriptionsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The live subscription with its plan, or the newest ended one when `includeEnded`. */
  async current(
    userId: string,
    includeEnded = false,
  ): Promise<{ subscription: Subscription; plan: Plan } | undefined> {
    const [row] = await this.handle.db
      .select({ subscription: subscriptions, plan: plans })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.ownerUserId, userId),
          includeEnded ? undefined : inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ),
      )
      .orderBy(desc(subscriptions.currentPeriodEnd), desc(subscriptions.id))
      .limit(1);
    return row;
  }

  async planKey(planId: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({ key: plans.key })
      .from(plans)
      .where(eq(plans.id, planId));
    return row?.key ?? null;
  }

  async lastOrderMonths(orderId: string | null, userId: string): Promise<number | null> {
    if (!orderId) return null;
    const [row] = await this.handle.db
      .select({ months: orders.months })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.ownerUserId, userId)));
    return row?.months ?? null;
  }

  trialAvailable(userId: string): Promise<boolean> {
    return trialAvailable(this.handle.db, userId);
  }

  startTrial(userId: string, planKey: string, now: Date): Promise<Subscription> {
    return startTrial(this.handle.db, { userId, planKey, now });
  }

  cancel(userId: string, now: Date): Promise<Subscription> {
    return cancelAtPeriodEnd(this.handle.db, { type: "user", id: userId }, now);
  }

  resume(userId: string, now: Date): Promise<Subscription> {
    return resume(this.handle.db, { type: "user", id: userId }, now);
  }

  async orders(userId: string, limit: number, cursor: Cursor | undefined): Promise<OrderListRow[]> {
    return this.handle.db
      .select({
        order: orders,
        planKey: plans.key,
        packKey: creditPacks.key,
        at: stamp(orders.createdAt),
      })
      .from(orders)
      .leftJoin(plans, eq(plans.id, orders.planId))
      .leftJoin(creditPacks, eq(creditPacks.id, orders.packId))
      .where(
        and(
          eq(orders.ownerUserId, userId),
          cursor ? afterCursor(orders.createdAt, orders.id, cursor, "uuid") : undefined,
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit + 1);
  }

  /** Everything a receipt shows, for a paid (or refunded) order of the caller; else undefined. */
  async receiptData(userId: string, orderId: string) {
    const [row] = await this.handle.db
      .select({ order: orders, planKey: plans.key, packKey: creditPacks.key, user: users })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.ownerUserId))
      .leftJoin(plans, eq(plans.id, orders.planId))
      .leftJoin(creditPacks, eq(creditPacks.id, orders.packId))
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.ownerUserId, userId),
          inArray(orders.status, [...RECEIPT_STATUSES]),
        ),
      );
    if (!row) return undefined;
    const [payment] = await this.handle.db
      .select({
        id: payments.id,
        reference: payments.reference,
        methodKey: payments.methodKey,
        nameAr: paymentMethods.nameAr,
        nameEn: paymentMethods.nameEn,
      })
      .from(payments)
      .leftJoin(paymentMethods, eq(paymentMethods.key, payments.methodKey))
      .where(
        and(
          eq(payments.orderId, orderId),
          inArray(payments.status, ["succeeded", "partially_refunded", "refunded"]),
        ),
      )
      .orderBy(desc(payments.updatedAt))
      .limit(1);
    const done = payment
      ? await this.handle.db
          .select({ amountMinor: refunds.amountMinor, createdAt: refunds.updatedAt })
          .from(refunds)
          .where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, "succeeded")))
          .orderBy(refunds.updatedAt)
      : [];
    return { ...row, payment, refunds: done };
  }
}
