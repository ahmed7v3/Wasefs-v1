import { Inject, Injectable } from "@nestjs/common";
import {
  deals,
  orders,
  organizations,
  outbox,
  recordOfflinePayment,
  planEntitlements,
  planPrices,
  plans,
  subscriptionEvents,
  subscriptions,
  type OfflinePaymentInput,
  type PaymentHooks,
  type Plan,
  type Transaction,
  type WalletOwner,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface LiveSubscriptionRow {
  id: string;
  planId: string;
  planKey: string;
  planMonthlyCredits: number;
  status: (typeof LIVE_SUBSCRIPTION_STATUSES)[number];
  source: string;
  currentPeriodEnd: Date;
}

const ownerOfSubscription = (owner: WalletOwner) =>
  owner.type === "user"
    ? eq(subscriptions.ownerUserId, owner.id)
    : eq(subscriptions.ownerOrgId, owner.id);

/** What the plan-change dialog needs to read; the writes are the `@wasfa/db` operations. */
@Injectable()
export class AdminPlanChangeRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * One transaction: the paid-offline order and its approved payment through the normal activation
   * (`recordOfflinePayment`), then `alsoInTransaction` (the extra credits). With `quiet`, the paid-order
   * outbox entry is closed so no receipt mail or message goes out (the admin unticked "notify").
   */
  recordPaidOffline(
    input: OfflinePaymentInput,
    hooks: PaymentHooks,
    now: Date,
    options: { quiet: boolean; alsoInTransaction: (tx: Transaction) => Promise<unknown> },
  ) {
    return this.handle.db.transaction(async (tx) => {
      const recorded = await recordOfflinePayment(tx, input, hooks, now);
      await options.alsoInTransaction(tx);
      if (options.quiet) {
        await tx
          .update(outbox)
          .set({ processedAt: sql`now()` })
          .where(eq(outbox.idempotencyKey, `order_paid:${recorded.order.id}`));
      }
      return recorded;
    });
  }

  async planByKey(key: string): Promise<Plan | undefined> {
    const [row] = await this.handle.db.select().from(plans).where(eq(plans.key, key));
    return row;
  }

  entitlements(planId: string) {
    return this.handle.db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, planId))
      .orderBy(asc(planEntitlements.task));
  }

  async liveSubscription(owner: WalletOwner): Promise<LiveSubscriptionRow | undefined> {
    const [row] = await this.handle.db
      .select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        planKey: plans.key,
        planMonthlyCredits: plans.monthlyCredits,
        status: subscriptions.status,
        source: subscriptions.source,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          ownerOfSubscription(owner),
          inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ),
      );
    return row as LiveSubscriptionRow | undefined;
  }

  /** The active list prices of a plan in one currency, shortest period first. */
  prices(planId: string, currency: string) {
    return this.handle.db
      .select({ months: planPrices.months, amountMinor: planPrices.amountMinor })
      .from(planPrices)
      .where(
        and(
          eq(planPrices.planId, planId),
          eq(planPrices.currency, currency),
          eq(planPrices.active, true),
        ),
      )
      .orderBy(asc(planPrices.months));
  }

  async dealIsActive(dealId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ status: deals.status })
      .from(deals)
      .where(eq(deals.id, dealId));
    return row?.status === "active";
  }

  async orgExists(orgId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return row !== undefined;
  }

  /** True when a change with this idempotency id already went through for this owner. */
  async alreadyApplied(owner: WalletOwner, requestId: string): Promise<boolean> {
    const [event] = await this.handle.db
      .select({ id: subscriptionEvents.id })
      .from(subscriptionEvents)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionEvents.subscriptionId))
      .where(
        and(
          ownerOfSubscription(owner),
          sql`${subscriptionEvents.data}->>'requestId' = ${requestId}`,
        ),
      )
      .limit(1);
    if (event) return true;
    const [order] = await this.handle.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          owner.type === "user"
            ? eq(orders.ownerUserId, owner.id)
            : eq(orders.ownerOrgId, owner.id),
          sql`${orders.quote}->>'requestId' = ${requestId}`,
        ),
      )
      .limit(1);
    return order !== undefined;
  }
}
