import { Inject, Injectable } from "@nestjs/common";
import {
  creditLedger,
  creditPacks,
  creditWallets,
  orders,
  organizations,
  paymentEvents,
  paymentMethods,
  payments,
  plans,
  referralCodes,
  referrals,
  refunds,
  subscriptionEvents,
  subscriptions,
  users,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES, type RefundStatus } from "@wasfa/shared/billing";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, escapeLike, stamp, type Cursor } from "../common/keyset.js";

import type { OrderListQuery, PaymentListQuery } from "@wasfa/shared/schemas/admin-billing-console";

const PAID_ORDER_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

/** `LIKE 'text%'` with the user's text taken literally. */
const prefixOf = (text: string) => `${escapeLike(text)}%`;

@Injectable()
export class AdminBillingRecordsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  // --- Payments ---------------------------------------------------------------------------------

  listPayments(query: PaymentListQuery, cursor: Cursor | undefined) {
    const conditions: Array<SQL | undefined> = [
      query.status ? eq(payments.status, query.status) : undefined,
      query.method ? eq(payments.methodKey, query.method) : undefined,
      query.from ? gte(payments.createdAt, query.from) : undefined,
      query.to ? lt(payments.createdAt, query.to) : undefined,
      query.minAmount === undefined ? undefined : gte(payments.amountMinor, query.minAmount),
      query.maxAmount === undefined ? undefined : lte(payments.amountMinor, query.maxAmount),
      query.needsReview
        ? inArray(payments.status, ["awaiting_review", "awaiting_second_approval"])
        : undefined,
      cursor ? afterCursor(payments.createdAt, payments.id, cursor, "uuid") : undefined,
    ];
    if (query.q) {
      const pattern = prefixOf(query.q);
      conditions.push(
        or(
          ilike(orders.number, pattern),
          ilike(payments.reference, pattern),
          sql`${payments.id}::text like ${pattern.toLowerCase()}`,
        ),
      );
    }
    return this.handle.db
      .select({
        id: payments.id,
        createdAt: payments.createdAt,
        at: stamp(payments.createdAt),
        orderId: orders.id,
        orderNumber: orders.number,
        reference: payments.reference,
        ownerUserId: orders.ownerUserId,
        ownerOrgId: orders.ownerOrgId,
        userName: users.name,
        userPhone: users.phone,
        orgName: organizations.name,
        planKey: plans.key,
        packKey: creditPacks.key,
        months: orders.months,
        methodKey: payments.methodKey,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        status: payments.status,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .leftJoin(plans, eq(plans.id, orders.planId))
      .leftJoin(creditPacks, eq(creditPacks.id, orders.packId))
      .leftJoin(users, eq(users.id, orders.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, orders.ownerOrgId))
      .where(and(...conditions))
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(query.limit + 1);
  }

  /**
   * The drawer's data. Columns are listed one by one: the sealed sender phone, the full transaction
   * id and the proof file never leave this query except as a mask or a yes/no.
   */
  async paymentRecord(id: string) {
    const [row] = await this.handle.db
      .select({
        payment: {
          id: payments.id,
          reference: payments.reference,
          status: payments.status,
          methodKey: payments.methodKey,
          amountMinor: payments.amountMinor,
          currency: payments.currency,
          txnId: payments.txnId,
          senderPhoneMasked: payments.senderPhoneMasked,
          hasProof: sql<boolean>`${payments.proofFileId} is not null`,
          flags: payments.flags,
          createdAt: payments.createdAt,
        },
        order: orders,
        planKey: plans.key,
        packKey: creditPacks.key,
        user: {
          id: users.id,
          name: users.name,
          phone: users.phone,
          email: users.email,
        },
        orgName: organizations.name,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .leftJoin(plans, eq(plans.id, orders.planId))
      .leftJoin(creditPacks, eq(creditPacks.id, orders.packId))
      .leftJoin(users, eq(users.id, orders.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, orders.ownerOrgId))
      .where(eq(payments.id, id));
    if (!row) return null;

    const ownerOrders = row.order.ownerUserId
      ? eq(orders.ownerUserId, row.order.ownerUserId)
      : eq(orders.ownerOrgId, row.order.ownerOrgId ?? "");
    const ownerSubscription = row.order.ownerUserId
      ? eq(subscriptions.ownerUserId, row.order.ownerUserId)
      : eq(subscriptions.ownerOrgId, row.order.ownerOrgId ?? "");
    const [events, paymentRefunds, previous, current, referral] = await Promise.all([
      this.handle.db
        .select({
          type: paymentEvents.type,
          time: paymentEvents.receivedAt,
          signatureOk: paymentEvents.signatureOk,
        })
        .from(paymentEvents)
        .where(eq(paymentEvents.paymentId, id))
        .orderBy(asc(paymentEvents.receivedAt), asc(paymentEvents.id)),
      this.handle.db
        .select({
          id: refunds.id,
          amountMinor: refunds.amountMinor,
          currency: refunds.currency,
          status: refunds.status,
          createdAt: refunds.createdAt,
        })
        .from(refunds)
        .where(eq(refunds.paymentId, id))
        .orderBy(desc(refunds.createdAt)),
      this.handle.db
        .select({ value: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            ownerOrders,
            ne(orders.id, row.order.id),
            inArray(orders.status, PAID_ORDER_STATUSES),
          ),
        ),
      this.handle.db
        .select({ key: plans.key })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(ownerSubscription, inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES)))
        .limit(1),
      row.order.ownerUserId
        ? this.handle.db
            .select({ code: referralCodes.code })
            .from(referrals)
            .innerJoin(referralCodes, eq(referralCodes.id, referrals.codeId))
            .where(eq(referrals.refereeUserId, row.order.ownerUserId))
            .limit(1)
        : Promise.resolve([] as Array<{ code: string }>),
    ]);
    return {
      ...row,
      events,
      refunds: paymentRefunds,
      previousPaidOrders: previous[0]?.value ?? 0,
      currentPlanKey: current[0]?.key ?? null,
      referralSourceCode: referral[0]?.code ?? null,
    };
  }

  async paymentOwner(id: string) {
    const [row] = await this.handle.db
      .select({ userId: orders.ownerUserId, orgId: orders.ownerOrgId })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(payments.id, id));
    return row ?? null;
  }

  // --- Refund preview ----------------------------------------------------------------------------

  /**
   * Everything the refund preview needs in one place: the payment, its order, what was already
   * refunded, the subscription the order activated (found the way `applyRefundToSubscription` finds
   * it), the credits the order granted and the owner's balance.
   */
  async refundPreviewData(id: string) {
    const [row] = await this.handle.db
      .select({
        payment: {
          id: payments.id,
          status: payments.status,
          amountMinor: payments.amountMinor,
          currency: payments.currency,
        },
        order: orders,
        planKey: plans.key,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .leftJoin(plans, eq(plans.id, orders.planId))
      .where(eq(payments.id, id));
    if (!row) return null;

    const walletOwner = row.order.ownerUserId
      ? eq(creditWallets.ownerUserId, row.order.ownerUserId)
      : eq(creditWallets.ownerOrgId, row.order.ownerOrgId ?? "");
    const [refunded, wallet, [activation]] = await Promise.all([
      this.handle.db
        .select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::int` })
        .from(refunds)
        .where(
          and(eq(refunds.paymentId, id), sql`${refunds.status} not in ('rejected', 'failed')`),
        ),
      this.handle.db
        .select({ balance: creditWallets.balance })
        .from(creditWallets)
        .where(walletOwner),
      row.order.kind === "credit_pack"
        ? Promise.resolve([])
        : this.handle.db
            .select({
              subscriptionId: subscriptionEvents.subscriptionId,
              activatedAt: subscriptionEvents.createdAt,
              conflict: sql<boolean>`coalesce((${subscriptionEvents.data}->>'conflict')::boolean, false)`,
            })
            .from(subscriptionEvents)
            .where(sql`${subscriptionEvents.data}->>'orderId' = ${row.order.id}`)
            .orderBy(asc(subscriptionEvents.createdAt))
            .limit(1),
    ]);

    const subscription = activation
      ? ((
          await this.handle.db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.id, activation.subscriptionId))
        )[0] ?? null)
      : null;

    let creditsGranted = 0;
    if (row.order.kind === "credit_pack") {
      const [pack] = await this.handle.db
        .select({ amount: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
        .from(creditLedger)
        .where(
          inArray(creditLedger.idempotencyKey, [
            `order:${row.order.id}`,
            `order:${row.order.id}:bonus`,
          ]),
        );
      creditsGranted = pack?.amount ?? 0;
    } else if (subscription && activation) {
      // The plan grants of this subscription since the order activated it. The activation event and
      // the first grant share one transaction, hence one database timestamp (the order paidAt comes
      // from the application clock and can be a few milliseconds later).
      const [grants] = await this.handle.db
        .select({ amount: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.kind, "grant"),
            sql`${creditLedger.idempotencyKey} like ${`grant:%:${subscription.id}:p%`}`,
            gte(creditLedger.createdAt, activation.activatedAt),
          ),
        );
      creditsGranted = grants?.amount ?? 0;
    }

    return {
      ...row,
      alreadyRefundedMinor: refunded[0]?.total ?? 0,
      balance: wallet[0]?.balance ?? 0,
      subscription,
      conflictingDowngrade: activation?.conflict ?? false,
      creditsGranted,
    };
  }

  // --- Orders ------------------------------------------------------------------------------------

  listOrders(query: OrderListQuery, cursor: Cursor | undefined) {
    const conditions: Array<SQL | undefined> = [
      query.status ? eq(orders.status, query.status) : undefined,
      query.kind ? eq(orders.kind, query.kind) : undefined,
      query.from ? gte(orders.createdAt, query.from) : undefined,
      query.to ? lt(orders.createdAt, query.to) : undefined,
      cursor ? afterCursor(orders.createdAt, orders.id, cursor, "uuid") : undefined,
    ];
    if (query.q) {
      const pattern = prefixOf(query.q);
      conditions.push(
        or(ilike(orders.number, pattern), sql`${orders.id}::text like ${pattern.toLowerCase()}`),
      );
    }
    return this.handle.db
      .select({
        id: orders.id,
        at: stamp(orders.createdAt),
        number: orders.number,
        kind: orders.kind,
        status: orders.status,
        planKey: plans.key,
        packKey: creditPacks.key,
        ownerUserId: orders.ownerUserId,
        ownerOrgId: orders.ownerOrgId,
        userName: users.name,
        orgName: organizations.name,
        subtotalMinor: orders.subtotalMinor,
        totalMinor: orders.totalMinor,
        currency: orders.currency,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
      })
      .from(orders)
      .leftJoin(plans, eq(plans.id, orders.planId))
      .leftJoin(creditPacks, eq(creditPacks.id, orders.packId))
      .leftJoin(users, eq(users.id, orders.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, orders.ownerOrgId))
      .where(and(...conditions))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(query.limit + 1);
  }

  async orderDetail(id: string) {
    const [row] = await this.handle.db
      .select({
        order: orders,
        planKey: plans.key,
        packKey: creditPacks.key,
        buyer: {
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          locale: users.locale,
          status: users.status,
        },
        orgName: organizations.name,
      })
      .from(orders)
      .leftJoin(plans, eq(plans.id, orders.planId))
      .leftJoin(creditPacks, eq(creditPacks.id, orders.packId))
      .leftJoin(users, eq(users.id, orders.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, orders.ownerOrgId))
      .where(eq(orders.id, id));
    if (!row) return null;
    const [orderPayments, orderRefunds] = await Promise.all([
      this.handle.db
        .select({
          id: payments.id,
          reference: payments.reference,
          methodKey: payments.methodKey,
          methodNameAr: paymentMethods.nameAr,
          methodNameEn: paymentMethods.nameEn,
          status: payments.status,
          amountMinor: payments.amountMinor,
          currency: payments.currency,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .leftJoin(paymentMethods, eq(paymentMethods.key, payments.methodKey))
        .where(eq(payments.orderId, id))
        .orderBy(desc(payments.createdAt)),
      this.handle.db
        .select({ amountMinor: refunds.amountMinor, createdAt: refunds.createdAt })
        .from(refunds)
        .innerJoin(payments, eq(payments.id, refunds.paymentId))
        .where(and(eq(payments.orderId, id), eq(refunds.status, "succeeded")))
        .orderBy(asc(refunds.createdAt)),
    ]);
    return { ...row, payments: orderPayments, refunds: orderRefunds };
  }

  // --- Refunds -----------------------------------------------------------------------------------

  listRefunds(limit: number, cursor: Cursor | undefined, status: RefundStatus | undefined) {
    const conditions: Array<SQL | undefined> = [
      status ? eq(refunds.status, status) : undefined,
      cursor ? afterCursor(refunds.createdAt, refunds.id, cursor, "uuid") : undefined,
    ];
    return this.handle.db
      .select({
        id: refunds.id,
        at: stamp(refunds.createdAt),
        paymentId: payments.id,
        orderId: orders.id,
        orderNumber: orders.number,
        amountMinor: refunds.amountMinor,
        currency: refunds.currency,
        status: refunds.status,
        reason: refunds.reason,
        transferReference: refunds.transferReference,
        createdAt: refunds.createdAt,
      })
      .from(refunds)
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(and(...conditions))
      .orderBy(desc(refunds.createdAt), desc(refunds.id))
      .limit(limit + 1);
  }
}
