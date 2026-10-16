import { Inject, Injectable } from "@nestjs/common";
import {
  activatePayment,
  applyProviderEvent,
  attachCheckout,
  cancelOrder,
  completeRefund,
  createOrder,
  failRefund,
  openRefund,
  orders,
  paymentMethods,
  payments,
  recordRejectedEvent,
  transitionPayment,
  type ActivationOutcome,
  type CreatedOrder,
  type NewOrderInput,
  type Order,
  type Payment,
  type PaymentHooks,
  type PaymentMethod,
  type ProviderEvent,
  type ProviderEventOutcome,
  type Refund,
  type RefundRequest,
} from "@wasfa/db";
import { and, asc, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

import type { PaymentStatus } from "@wasfa/shared/billing";

/**
 * Database access of the payments domain. The state machine itself lives in `@wasfa/db`
 * (`payments.ts`) so the worker runs the same transactions; this class is the API's door to it.
 */
@Injectable()
export class PaymentsRepo {
  private readonly userOrders: ScopedRepo<typeof orders>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.userOrders = scopedRepo(handle.db, {
      table: orders,
      scope: orders.ownerUserId,
      id: orders.id,
    });
  }

  /** An enabled method by key. */
  async enabledMethod(key: string): Promise<PaymentMethod | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.key, key), eq(paymentMethods.enabled, true)));
    return row;
  }

  createOrder(input: NewOrderInput, hooks: PaymentHooks, now: Date): Promise<CreatedOrder> {
    return createOrder(this.handle.db, input, hooks, now);
  }

  attachCheckout(paymentId: string, providerRef: string | null): Promise<Payment> {
    return attachCheckout(this.handle.db, paymentId, providerRef);
  }

  transition(
    paymentId: string,
    to: PaymentStatus,
    patch: { failureCode?: string; providerRef?: string; reason?: string } = {},
  ): Promise<Payment> {
    return transitionPayment(this.handle.db, paymentId, to, patch);
  }

  activate(
    paymentId: string,
    reported: { amountMinor: number | null; currency: string | null },
    hooks: PaymentHooks,
  ): Promise<ActivationOutcome> {
    return activatePayment(this.handle.db, paymentId, reported, hooks);
  }

  applyProviderEvent(event: ProviderEvent, hooks: PaymentHooks): Promise<ProviderEventOutcome> {
    return applyProviderEvent(this.handle.db, event, hooks);
  }

  recordRejectedEvent(provider: string, payload: Record<string, unknown>): Promise<void> {
    return recordRejectedEvent(this.handle.db, provider, payload);
  }

  cancelOrder(orderId: string): Promise<Order> {
    return cancelOrder(this.handle.db, orderId);
  }

  /** The caller's own order, or null (another owner's order does not exist for them). */
  userOrder(userId: string, orderId: string): Promise<Order | null> {
    return this.userOrders.find(userId, orderId);
  }

  orderPayments(orderId: string): Promise<Payment[]> {
    return this.handle.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(asc(payments.createdAt));
  }

  async payment(paymentId: string): Promise<Payment | undefined> {
    const [row] = await this.handle.db.select().from(payments).where(eq(payments.id, paymentId));
    return row;
  }

  openRefund(request: RefundRequest): Promise<Refund> {
    return openRefund(this.handle.db, request);
  }

  completeRefund(
    refundId: string,
    result: {
      providerRef?: string;
      transferReference?: string;
      clawbackCredits: number;
      actorId: string;
    },
    hooks: PaymentHooks,
  ): Promise<Refund> {
    return completeRefund(this.handle.db, refundId, result, hooks);
  }

  failRefund(refundId: string): Promise<void> {
    return failRefund(this.handle.db, refundId);
  }
}
