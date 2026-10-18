import { Inject, Injectable } from "@nestjs/common";
import {
  aiUsage,
  coupons,
  creditLedger,
  growthEvents,
  orders,
  paymentMethods,
  payments,
  plans,
  pointsLedger,
  promotions,
  referrals,
  refunds,
  subscriptions,
  users,
  organizations,
  withdrawalRequests,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  lte,
  sql,
  sum,
} from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

const PAID_ORDER_STATUSES = ["paid", "partially_refunded", "refunded"] as const;
const REVIEW_STATUSES = ["awaiting_review", "awaiting_second_approval"] as const;
const FUNNEL_STEPS = ["pricing_viewed", "checkout_started", "payment_succeeded"] as const;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface OverviewWindow {
  from: Date;
  to: Date;
}

export type PerCurrency = Record<string, number>;

export interface PeriodKpis {
  revenueNetMinor: PerCurrency;
  refundsMinor: PerCurrency;
  orders: number;
  newPaidSubscribers: number;
  mrrMinor: PerCurrency;
  arpuMinor: PerCurrency;
  refundRateBps: number;
  aiCostUsdMicros: number;
  creditsSold: number;
  creditsConsumed: number;
  rewardsAccruedPoints: number;
  rewardsPaidPoints: number;
}

const secondsSince = (at: Date | null, now: Date) =>
  at ? Math.max(0, Math.floor((now.getTime() - at.getTime()) / 1000)) : 0;

/**
 * The aggregates behind the billing overview. Each figure is one grouped query (no per-row
 * lookups), and every sum of money is grouped by currency: two currencies are never added.
 */
@Injectable()
export class AdminBillingOverviewRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  // --- Counters for the sidebar badges ------------------------------------------------------------

  async counts() {
    const [[payment], [withdrawal], fraud] = await Promise.all([
      this.handle.db
        .select({ value: count() })
        .from(payments)
        .where(inArray(payments.status, REVIEW_STATUSES)),
      // `approved` withdrawals wait for the payout, a different queue.
      this.handle.db
        .select({ value: count() })
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.status, "requested")),
      this.heldReferrals(),
    ]);
    return {
      paymentsToReview: payment?.value ?? 0,
      withdrawalsToReview: withdrawal?.value ?? 0,
      fraudHolds: fraud,
    };
  }

  /** The fraud queue is the set of referrals held for review (`referrals_held_idx`). */
  private async heldReferrals(): Promise<number> {
    const [row] = await this.handle.db
      .select({ value: count() })
      .from(referrals)
      .where(eq(referrals.status, "held"));
    return row?.value ?? 0;
  }

  // --- KPIs of one window ------------------------------------------------------------------------

  async kpis({ from, to }: OverviewWindow): Promise<PeriodKpis> {
    const inWindow = and(
      inArray(orders.status, PAID_ORDER_STATUSES),
      gte(orders.paidAt, from),
      lt(orders.paidAt, to),
    );
    const [sales, refundRows, mrrRows, newSubscribers, ai, credits, points] = await Promise.all([
      this.handle.db
        .select({
          currency: orders.currency,
          revenue: sum(orders.subtotalMinor).mapWith(Number),
          orders: count(),
          returned: sql<number>`count(*) filter (where ${orders.status} <> 'paid')::int`,
          payers: countDistinct(sql`coalesce(${orders.ownerUserId}, ${orders.ownerOrgId})`),
        })
        .from(orders)
        .where(inWindow)
        .groupBy(orders.currency),
      this.handle.db
        .select({ currency: refunds.currency, amount: sum(refunds.amountMinor).mapWith(Number) })
        .from(refunds)
        .where(
          and(
            eq(refunds.status, "succeeded"),
            gte(refunds.createdAt, from),
            lt(refunds.createdAt, to),
          ),
        )
        .groupBy(refunds.currency),
      // Live paid subscriptions as of now: the last paid order spread over the months it bought.
      this.handle.db
        .select({
          currency: orders.currency,
          amount:
            sql<number>`coalesce(sum(floor(${orders.subtotalMinor}::numeric / greatest(${orders.months}, 1))), 0)::bigint`.mapWith(
              Number,
            ),
        })
        .from(subscriptions)
        .innerJoin(orders, eq(orders.id, subscriptions.lastOrderId))
        .where(
          and(
            eq(subscriptions.source, "paid"),
            inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
            inArray(orders.status, PAID_ORDER_STATUSES),
          ),
        )
        .groupBy(orders.currency),
      // Owners whose first paid subscription order was paid inside the window.
      this.handle.db.execute<{ value: number }>(sql`
        select count(*)::int as value from (
          select coalesce(owner_user_id, owner_org_id) as owner
          from orders
          where kind in ('subscription', 'upgrade')
            and status in ('paid', 'partially_refunded', 'refunded')
            and paid_at is not null
          group by 1
          having min(paid_at) >= ${from.toISOString()}::timestamptz
             and min(paid_at) < ${to.toISOString()}::timestamptz
        ) firsts
      `),
      this.handle.db
        .select({ cost: sum(aiUsage.costUsdMicros).mapWith(Number) })
        .from(aiUsage)
        .where(and(gte(aiUsage.createdAt, from), lt(aiUsage.createdAt, to))),
      this.handle.db
        .select({
          sold: sql<number>`coalesce(sum(${creditLedger.amount}) filter (where ${creditLedger.kind} = 'purchase'), 0)::bigint`.mapWith(
            Number,
          ),
          consumed:
            sql<number>`coalesce(-sum(${creditLedger.amount}) filter (where ${creditLedger.kind} = 'usage_settle'), 0)::bigint`.mapWith(
              Number,
            ),
        })
        .from(creditLedger)
        .where(and(gte(creditLedger.createdAt, from), lt(creditLedger.createdAt, to))),
      this.handle.db
        .select({
          accrued:
            sql<number>`coalesce(sum(${pointsLedger.amount}) filter (where ${pointsLedger.kind} = 'reward_pending'), 0)::bigint`.mapWith(
              Number,
            ),
          paid: sql<number>`coalesce(sum(abs(${pointsLedger.amount})) filter (where ${pointsLedger.kind} = 'withdraw_paid'), 0)::bigint`.mapWith(
            Number,
          ),
        })
        .from(pointsLedger)
        .where(and(gte(pointsLedger.createdAt, from), lt(pointsLedger.createdAt, to))),
    ]);

    const revenueNetMinor: PerCurrency = {};
    const arpuMinor: PerCurrency = {};
    let paidOrders = 0;
    let returnedOrders = 0;
    for (const row of sales) {
      revenueNetMinor[row.currency] = row.revenue ?? 0;
      arpuMinor[row.currency] = row.payers > 0 ? Math.floor((row.revenue ?? 0) / row.payers) : 0;
      paidOrders += row.orders;
      returnedOrders += row.returned;
    }
    const refundsMinor: PerCurrency = {};
    for (const row of refundRows) refundsMinor[row.currency] = row.amount ?? 0;
    const mrrMinor: PerCurrency = {};
    for (const row of mrrRows) mrrMinor[row.currency] = row.amount;

    return {
      revenueNetMinor,
      refundsMinor,
      orders: paidOrders,
      newPaidSubscribers: newSubscribers[0]?.value ?? 0,
      mrrMinor,
      arpuMinor,
      refundRateBps: paidOrders > 0 ? Math.floor((returnedOrders * 10_000) / paidOrders) : 0,
      aiCostUsdMicros: ai[0]?.cost ?? 0,
      creditsSold: credits[0]?.sold ?? 0,
      creditsConsumed: credits[0]?.consumed ?? 0,
      rewardsAccruedPoints: points[0]?.accrued ?? 0,
      rewardsPaidPoints: points[0]?.paid ?? 0,
    };
  }

  // --- Mix, discounts, funnel ---------------------------------------------------------------------

  async planMix({ from, to }: OverviewWindow) {
    const rows = await this.handle.db
      .select({
        planKey: plans.key,
        currency: orders.currency,
        orders: count(),
        amountMinor: sum(orders.subtotalMinor).mapWith(Number),
      })
      .from(orders)
      .leftJoin(plans, eq(plans.id, orders.planId))
      .where(
        and(
          inArray(orders.status, PAID_ORDER_STATUSES),
          gte(orders.paidAt, from),
          lt(orders.paidAt, to),
        ),
      )
      .groupBy(plans.key, orders.currency)
      .orderBy(desc(sum(orders.subtotalMinor)));
    return rows.map((row) => ({ ...row, amountMinor: row.amountMinor ?? 0 }));
  }

  /** Top five coupons and promotions by the revenue of the paid orders that used them. */
  async topDiscounts({ from, to }: OverviewWindow) {
    const paidInWindow = and(
      inArray(orders.status, PAID_ORDER_STATUSES),
      gte(orders.paidAt, from),
      lt(orders.paidAt, to),
    );
    const revenue = sum(orders.subtotalMinor).mapWith(Number);
    const [couponRows, promotionRows] = await Promise.all([
      this.handle.db
        .select({
          id: coupons.id,
          name: coupons.code,
          currency: orders.currency,
          revenueMinor: revenue,
        })
        .from(orders)
        .innerJoin(coupons, sql`${orders.applied}->>'couponId' = ${coupons.id}::text`)
        .where(paidInWindow)
        .groupBy(coupons.id, coupons.code, orders.currency)
        .orderBy(desc(revenue))
        .limit(5),
      this.handle.db
        .select({
          id: promotions.id,
          name: promotions.name,
          currency: orders.currency,
          revenueMinor: revenue,
        })
        .from(orders)
        .innerJoin(promotions, sql`${orders.applied}->>'promotionId' = ${promotions.id}::text`)
        .where(paidInWindow)
        .groupBy(promotions.id, promotions.name, orders.currency)
        .orderBy(desc(revenue))
        .limit(5),
    ]);
    return {
      coupons: couponRows.map((row) => ({ ...row, revenueMinor: row.revenueMinor ?? 0 })),
      promotions: promotionRows.map((row) => ({ ...row, revenueMinor: row.revenueMinor ?? 0 })),
    };
  }

  /**
   * Distinct sessions per funnel step: once overall and once per payment method (the method is
   * recorded in the event props from the method step onwards). Steps without events are zeros.
   */
  async funnel({ from, to }: OverviewWindow) {
    const inWindow = and(
      inArray(growthEvents.name, FUNNEL_STEPS),
      gte(growthEvents.occurredAt, from),
      lt(growthEvents.occurredAt, to),
    );
    const methodKey = sql<string | null>`${growthEvents.props}->>'methodKey'`;
    const [totals, byMethod] = await Promise.all([
      this.handle.db
        .select({ step: growthEvents.name, sessions: countDistinct(growthEvents.sessionId) })
        .from(growthEvents)
        .where(inWindow)
        .groupBy(growthEvents.name),
      this.handle.db
        .select({
          step: growthEvents.name,
          methodKey,
          sessions: countDistinct(growthEvents.sessionId),
        })
        .from(growthEvents)
        .where(and(inWindow, isNotNull(methodKey)))
        .groupBy(growthEvents.name, methodKey),
    ]);
    return [
      ...FUNNEL_STEPS.map((step) => ({
        step,
        methodKey: null,
        sessions: totals.find((row) => row.step === step)?.sessions ?? 0,
      })),
      ...byMethod.map((row) => ({
        step: row.step,
        methodKey: row.methodKey,
        sessions: row.sessions,
      })),
    ];
  }

  // --- What needs a human today -------------------------------------------------------------------

  async attention(reviewSlaMinutes: number, now: Date) {
    const pastDay = new Date(now.getTime() - 24 * HOUR_MS);
    const [
      [manual],
      [withdrawal],
      fraudHolds,
      [failed],
      endingSubscriptions,
      endingPromotions,
      nearLimitCoupons,
    ] = await Promise.all([
      this.handle.db
        .select({
          count: count(),
          oldest: sql<Date | null>`min(${payments.createdAt})`.mapWith((value) =>
            value === null ? null : new Date(value as string),
          ),
          overdue: sql<number>`count(*) filter (where ${payments.createdAt} + make_interval(mins => coalesce(${paymentMethods.reviewSlaMinutes}, ${reviewSlaMinutes})) < ${now.toISOString()}::timestamptz)::int`,
        })
        .from(payments)
        .leftJoin(paymentMethods, eq(paymentMethods.key, payments.methodKey))
        .where(inArray(payments.status, REVIEW_STATUSES)),
      this.handle.db
        .select({
          count: count(),
          oldest: sql<Date | null>`min(${withdrawalRequests.createdAt})`.mapWith((value) =>
            value === null ? null : new Date(value as string),
          ),
        })
        .from(withdrawalRequests)
        .where(eq(withdrawalRequests.status, "requested")),
      this.heldReferrals(),
      this.handle.db
        .select({ value: count() })
        .from(payments)
        .where(
          and(
            gte(payments.updatedAt, pastDay),
            sql`(${payments.status} = 'failed' or ${payments.failureCode} = 'amount_mismatch')`,
          ),
        ),
      this.handle.db
        .select({
          id: subscriptions.id,
          planKey: plans.key,
          periodEnd: subscriptions.currentPeriodEnd,
          subtotalMinor: orders.subtotalMinor,
          ownerUserName: users.name,
          ownerOrgName: organizations.name,
        })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .leftJoin(orders, eq(orders.id, subscriptions.lastOrderId))
        .leftJoin(users, eq(users.id, subscriptions.ownerUserId))
        .leftJoin(organizations, eq(organizations.id, subscriptions.ownerOrgId))
        .where(
          and(
            inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
            gte(subscriptions.currentPeriodEnd, now),
            lte(subscriptions.currentPeriodEnd, new Date(now.getTime() + 3 * DAY_MS)),
          ),
        )
        .orderBy(sql`${orders.subtotalMinor} desc nulls last`, desc(subscriptions.id))
        .limit(5),
      this.handle.db
        .select({ id: promotions.id, name: promotions.name, endsAt: promotions.endsAt })
        .from(promotions)
        .where(
          and(
            eq(promotions.status, "active"),
            isNotNull(promotions.endsAt),
            gte(promotions.endsAt, now),
            lte(promotions.endsAt, new Date(now.getTime() + 48 * HOUR_MS)),
          ),
        )
        .orderBy(promotions.endsAt)
        .limit(10),
      this.handle.db
        .select({
          id: coupons.id,
          code: coupons.code,
          redeemed: coupons.redeemedCount,
          max: coupons.maxRedemptions,
        })
        .from(coupons)
        .where(
          and(
            eq(coupons.status, "active"),
            isNotNull(coupons.maxRedemptions),
            sql`${coupons.redeemedCount} * 5 >= ${coupons.maxRedemptions} * 4`,
          ),
        )
        .orderBy(desc(coupons.redeemedCount))
        .limit(10),
    ]);
    return {
      manual: {
        count: manual?.count ?? 0,
        oldestSeconds: secondsSince(manual?.oldest ?? null, now),
        overdueCount: manual?.overdue ?? 0,
      },
      withdrawal: {
        count: withdrawal?.count ?? 0,
        oldestSeconds: secondsSince(withdrawal?.oldest ?? null, now),
      },
      fraudHolds,
      failedOrMismatch24h: failed?.value ?? 0,
      endingSubscriptions,
      endingPromotions,
      nearLimitCoupons,
    };
  }
}
