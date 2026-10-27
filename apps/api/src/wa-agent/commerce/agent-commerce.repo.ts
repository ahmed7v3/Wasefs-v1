import { Inject, Injectable } from "@nestjs/common";
import {
  coupons,
  mintAgentCoupon,
  orders,
  paymentMethods,
  payments,
  plans,
  setMessagesMeta,
  users,
  waConversations,
  waMessages,
  type AgentCouponInput,
  type AgentCouponResult,
  voidAgentCoupon,
  type Order,
  type Payment,
  type Coupon,
  type PaymentMethod,
  type WaConversation,
  WA_AGENT_COUPON_CAMPAIGN,
} from "@wasfa/db";
import { and, count, desc, eq, gt, gte, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

/** Who the agent acts for: only what a service call needs, loaded by the server from the chat's link. */
export interface AgentUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: "active" | "suspended" | "deleted";
}

/** An inbound picture or file of a chat, as the commerce tools pick them. */
export interface InboundMedia {
  id: string;
  kind: "image" | "document";
  mediaKey: string;
  mediaMime: string;
  mediaBytes: number;
  createdAt: Date;
}

export interface OrderWithPayment {
  order: Order;
  payment: Payment;
}

/** The only place the agent's commerce tools touch the database. Every read is for one user id. */
@Injectable()
export class WaAgentCommerceRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async user(userId: string): Promise<AgentUserRow | null> {
    const [row] = await this.handle.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        phoneVerified: users.phoneVerified,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  /** Customer messages of the chat (the discount policy waits for a real conversation). */
  async customerMessageCount(conversationId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: count() })
      .from(waMessages)
      .where(and(eq(waMessages.conversationId, conversationId), eq(waMessages.direction, "in")));
    return row?.total ?? 0;
  }

  /** Agent coupons this user ever got; the policy's lifetime limit is checked again under the lock. */
  async agentCouponCount(userId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: count() })
      .from(coupons)
      .where(and(eq(coupons.campaign, WA_AGENT_COUPON_CAMPAIGN), eq(coupons.targetUserId, userId)));
    return row?.total ?? 0;
  }

  mintCoupon(input: AgentCouponInput): Promise<AgentCouponResult> {
    return mintAgentCoupon(this.handle.db, input);
  }

  /** Withdraws a coupon that gave no discount (never redeemed); see `voidAgentCoupon`. */
  voidCoupon(couponId: string): Promise<boolean> {
    return voidAgentCoupon(this.handle.db, couponId);
  }

  async plan(
    planId: string,
  ): Promise<{ id: string; key: string; nameAr: string; nameEn: string } | null> {
    const [row] = await this.handle.db
      .select({ id: plans.id, key: plans.key, nameAr: plans.nameAr, nameEn: plans.nameEn })
      .from(plans)
      .where(eq(plans.id, planId));
    return row ?? null;
  }

  /** The enabled manual bank-transfer method for this market that takes a proof, cheapest sort first. */
  async bankMethod(currency: string, country: string | null): Promise<PaymentMethod | null> {
    const rows = await this.handle.db
      .select()
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.enabled, true),
          eq(paymentMethods.kind, "manual"),
          eq(paymentMethods.requiresProof, true),
          eq(paymentMethods.provider, "bank_transfer"),
          sql`${currency} = any(${paymentMethods.currencies})`,
        ),
      )
      .orderBy(paymentMethods.sort, paymentMethods.key);
    return (
      rows.find(
        (row) => row.countries === null || (country !== null && row.countries.includes(country)),
      ) ?? null
    );
  }

  /**
   * An open order of this user for the same plan and months, paid by `methodKey` and still waiting
   * for the transfer (or for a corrected proof). Newest first.
   */
  async openOrders(
    userId: string,
    planId: string,
    months: number,
    methodKey: string,
    now: Date,
  ): Promise<OrderWithPayment[]> {
    const rows = await this.handle.db
      .select({ order: orders, payment: payments })
      .from(orders)
      .innerJoin(payments, eq(payments.orderId, orders.id))
      .where(
        and(
          eq(orders.ownerUserId, userId),
          eq(orders.status, "pending_payment"),
          eq(orders.planId, planId),
          eq(orders.months, months),
          eq(payments.methodKey, methodKey),
          eq(payments.status, "awaiting_customer"),
          gt(orders.expiresAt, now),
        ),
      )
      .orderBy(desc(orders.createdAt));
    return rows;
  }

  /** The user's own order with its newest payment, or null. */
  async orderWithPayment(userId: string, orderId: string): Promise<OrderWithPayment | null> {
    const [row] = await this.handle.db
      .select({ order: orders, payment: payments })
      .from(orders)
      .innerJoin(payments, eq(payments.orderId, orders.id))
      .where(and(eq(orders.id, orderId), eq(orders.ownerUserId, userId)))
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** The user's newest manual payment that still takes a proof (open order, not yet in review). */
  async newestProofTarget(userId: string, now: Date): Promise<OrderWithPayment | null> {
    const [row] = await this.handle.db
      .select({ order: orders, payment: payments })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(
        and(
          eq(orders.ownerUserId, userId),
          eq(orders.status, "pending_payment"),
          inArray(payments.status, ["awaiting_customer", "rejected"]),
          gt(orders.expiresAt, now),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return row ?? null;
  }

  async method(key: string): Promise<PaymentMethod | null> {
    const [row] = await this.handle.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, key));
    return row ?? null;
  }

  /** The newest picture or PDF the customer sent since `since` that no tool used yet (`meta.<usedKey>`). */
  async newestUnusedMedia(
    conversationId: string,
    kinds: readonly ("image" | "document")[],
    since: Date,
    usedKey: "attachedAs" | "rxId",
    limit: number,
  ): Promise<InboundMedia[]> {
    const rows = await this.handle.db
      .select({
        id: waMessages.id,
        kind: waMessages.kind,
        mediaKey: waMessages.mediaKey,
        mediaMime: waMessages.mediaMime,
        mediaBytes: waMessages.mediaBytes,
        createdAt: waMessages.createdAt,
      })
      .from(waMessages)
      .where(
        and(
          eq(waMessages.conversationId, conversationId),
          eq(waMessages.direction, "in"),
          inArray(waMessages.kind, [...kinds]),
          gte(waMessages.createdAt, since),
          sql`not (${waMessages.meta} ? ${usedKey})`,
        ),
      )
      .orderBy(desc(waMessages.createdAt), desc(waMessages.id))
      .limit(limit);
    return rows.flatMap((row) =>
      (row.kind === "image" || row.kind === "document") &&
      row.mediaKey !== null &&
      row.mediaMime !== null
        ? [
            {
              id: row.id,
              kind: row.kind,
              mediaKey: row.mediaKey,
              mediaMime: row.mediaMime,
              mediaBytes: row.mediaBytes ?? 0,
              createdAt: row.createdAt,
            },
          ]
        : [],
    );
  }

  /**
   * Marks a message as used, only while nobody else did (the first caller wins). Two tool calls on
   * the same picture cannot both attach it.
   */
  async claimMedia(messageId: string, usedKey: "attachedAs" | "rxId"): Promise<boolean> {
    const rows = await this.handle.db
      .update(waMessages)
      .set({ meta: sql`${waMessages.meta} || ${JSON.stringify({ [usedKey]: "pending" })}::jsonb` })
      .where(and(eq(waMessages.id, messageId), sql`not (${waMessages.meta} ? ${usedKey})`))
      .returning({ id: waMessages.id });
    return rows.length > 0;
  }

  /** Gives a claim back when the work it was for failed. */
  async releaseMedia(messageId: string, usedKey: "attachedAs" | "rxId"): Promise<void> {
    await this.handle.db
      .update(waMessages)
      .set({ meta: sql`${waMessages.meta} - ${usedKey}::text` })
      .where(eq(waMessages.id, messageId));
  }

  /** Records what a claimed message became (`attachedAs: { fileId, paymentId }`, `rxId`). */
  setMediaMeta(messageId: string, meta: Record<string, unknown>): Promise<void> {
    return setMessagesMeta(this.handle.db, [messageId], meta);
  }

  /** The user's chat with a customer message since `since` (the follow-up window), newest first. */
  async recentConversation(userId: string, since: Date): Promise<WaConversation | null> {
    const [row] = await this.handle.db
      .select()
      .from(waConversations)
      .where(and(eq(waConversations.userId, userId), gte(waConversations.lastInboundAt, since)))
      .orderBy(desc(waConversations.lastInboundAt))
      .limit(1);
    return row ?? null;
  }

  /** Coupon of the user with this code, for the "which coupon was reused" lookup. */
  async couponOf(userId: string, code: string): Promise<Coupon | null> {
    const [row] = await this.handle.db
      .select()
      .from(coupons)
      .where(and(eq(coupons.code, code), eq(coupons.targetUserId, userId)));
    return row ?? null;
  }
}
