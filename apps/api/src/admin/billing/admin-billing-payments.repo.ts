import { Inject, Injectable } from "@nestjs/common";
import {
  approveManualPayment,
  orders,
  paymentMethods,
  payments,
  users,
  files,
  rejectManualPayment,
  requestManualProof,
  plans,
  paymentEvents,
} from "@wasfa/db";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { PaymentHooks } from "@wasfa/db";

@Injectable()
export class AdminBillingPaymentsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}
  approve(id: string, adminId: string, threshold: number, hooks: PaymentHooks, note?: string) {
    return approveManualPayment(this.handle.db, id, adminId, threshold, hooks, note);
  }
  reject(id: string, adminId: string, reason: string, note?: string) {
    return rejectManualPayment(this.handle.db, id, adminId, reason, note);
  }
  requestProof(id: string, note?: string) {
    return requestManualProof(this.handle.db, id, note);
  }

  queue(limit: number, reviewSlaMinutes: number, cursor?: string) {
    const [priorityRaw, date, id] = cursor?.split("|") ?? [];
    const priority = Number(priorityRaw);
    const reviewEnteredAt = sql<Date>`coalesce((
      select max(${paymentEvents.receivedAt})
      from ${paymentEvents}
      where ${paymentEvents.paymentId} = ${payments.id}
        and ${paymentEvents.type} = 'transition'
        and ${paymentEvents.payload}->>'to' = ${payments.status}
    ), ${payments.updatedAt})`;
    const overduePriority = sql<number>`case when ${reviewEnteredAt} + make_interval(mins => coalesce(${paymentMethods.reviewSlaMinutes}, ${reviewSlaMinutes})) < now() then 0 else 1 end`;
    const after =
      (priority === 0 || priority === 1) && date && id && !Number.isNaN(Date.parse(date))
        ? or(
            gt(overduePriority, priority),
            and(
              eq(overduePriority, priority),
              or(
                gt(reviewEnteredAt, new Date(date)),
                and(eq(reviewEnteredAt, new Date(date)), gt(payments.id, id)),
              ),
            ),
          )
        : undefined;
    return this.handle.db
      .select({
        payment: payments,
        order: orders,
        method: paymentMethods,
        user: users,
        reviewEnteredAt,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(paymentMethods, eq(paymentMethods.key, payments.methodKey))
      .leftJoin(users, eq(users.id, orders.ownerUserId))
      .where(
        and(
          inArray(payments.status, ["awaiting_review", "awaiting_second_approval"]),
          ...(after ? [after] : []),
        ),
      )
      .orderBy(asc(overduePriority), asc(reviewEnteredAt), asc(payments.id))
      .limit(limit + 1);
  }

  async detail(id: string) {
    const [row] = await this.handle.db
      .select({
        payment: payments,
        order: orders,
        method: paymentMethods,
        user: users,
        file: files,
        plan: plans,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .innerJoin(paymentMethods, eq(paymentMethods.key, payments.methodKey))
      .leftJoin(plans, eq(plans.id, orders.planId))
      .leftJoin(users, eq(users.id, orders.ownerUserId))
      .leftJoin(files, eq(files.id, payments.proofFileId))
      .where(eq(payments.id, id));
    return row;
  }

  async isOwnPayment(paymentId: string, userId: string, orgIds: string[]) {
    const row = await this.detail(paymentId);
    return Boolean(
      row &&
      (row.order.ownerUserId === userId ||
        (row.order.ownerOrgId && orgIds.includes(row.order.ownerOrgId))),
    );
  }

  async paidOrderCount(userId: string) {
    const rows = await this.handle.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.ownerUserId, userId), eq(orders.status, "paid")));
    return rows.length;
  }

  async earlierRejected(userId: string) {
    return this.handle.db
      .select({
        paymentId: payments.id,
        reason: payments.rejectReason,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(and(eq(orders.ownerUserId, userId), eq(payments.status, "rejected")))
      .orderBy(asc(payments.createdAt))
      .limit(20);
  }

  async userName(id: string) {
    const [row] = await this.handle.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, id));
    return row?.name ?? null;
  }
}
