import { Injectable } from "@nestjs/common";
import { SubscriptionsError, type Plan, type Subscription } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  anniversaries,
  buildReceipt,
  pendingChangeSchema,
  type Receipt,
} from "@wasfa/shared/subscriptions";

import { decodeCursor, encodeCursor } from "../admin/common/keyset.js";
import { AuthRateLimiter } from "../auth/rate-limiter.js";
import { QuoteService } from "../billing/quote.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { SubscriptionsRepo } from "./subscriptions.repo.js";

import type { Market } from "../catalog/market.js";
import type {
  MyOrdersResponse,
  MySubscriptionResponse,
  RenewQuoteInput,
  SubscriptionView,
} from "@wasfa/shared/schemas/subscriptions";

/** The customer side of subscriptions (BILLING §7): view, cancel, resume, trial, renew, history. */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly repo: SubscriptionsRepo,
    private readonly quotes: QuoteService,
    private readonly settings: SettingsService,
    private readonly limiter: AuthRateLimiter,
  ) {}

  async mine(userId: string, now = new Date()): Promise<MySubscriptionResponse> {
    const current = await this.repo.current(userId);
    return {
      subscription: current ? await this.view(current.subscription, current.plan, now) : null,
      trialAvailable: await this.repo.trialAvailable(userId),
    };
  }

  async cancel(userId: string, now = new Date()): Promise<MySubscriptionResponse> {
    await this.run(() => this.repo.cancel(userId, now));
    return this.mine(userId, now);
  }

  async resume(userId: string, now = new Date()): Promise<MySubscriptionResponse> {
    await this.run(() => this.repo.resume(userId, now));
    return this.mine(userId, now);
  }

  async startTrial(userId: string, planKey: string, now = new Date()) {
    // Per account, on top of the per-IP route limit: a trial grants credits.
    await this.limiter.hit(`trial:user:${userId}`, 5, 3_600);
    await this.run(() => this.repo.startTrial(userId, planKey, now));
    return this.mine(userId, now);
  }

  /** A quote for the same plan again (the one-tap renew link); the plan never comes from the client. */
  async renewQuote(userId: string, input: RenewQuoteInput, market: Market, ip: string) {
    const current = await this.repo.current(userId, true);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);
    const months =
      input.months ??
      (await this.repo.lastOrderMonths(current.subscription.lastOrderId, userId)) ??
      1;
    return this.quotes.quote(
      userId,
      {
        planKey: current.plan.key,
        months,
        ...(input.methodKey ? { methodKey: input.methodKey } : {}),
      },
      market,
      ip,
    );
  }

  async orders(userId: string, limit: number, rawCursor?: string): Promise<MyOrdersResponse> {
    const rows = await this.repo.orders(userId, limit, decodeCursor(rawCursor, "uuid"));
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map(({ order, planKey, packKey }) => ({
        id: order.id,
        number: order.number,
        kind: order.kind,
        planKey,
        packKey,
        months: order.months,
        totalMinor: order.totalMinor,
        currency: order.currency,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
        receiptAvailable: ["paid", "partially_refunded", "refunded"].includes(order.status),
      })),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ at: last.at, key: last.order.id }) : null,
    };
  }

  async receipt(userId: string, orderId: string): Promise<Receipt> {
    const data = await this.repo.receiptData(userId, orderId);
    if (!data) throw new AppError(ErrorCode.NOT_FOUND);
    const { company } = await this.settings.get("billing");
    const quote = data.order.quote as { lines?: unknown; taxMode?: "added" | "inclusive" | null };
    return buildReceipt({
      order: {
        number: data.order.number,
        kind: data.order.kind,
        planKey: data.planKey,
        packKey: data.packKey,
        months: data.order.months,
        currency: data.order.currency,
        subtotalMinor: data.order.subtotalMinor,
        discountMinor: data.order.discountMinor,
        taxMinor: data.order.taxMinor,
        feeMinor: data.order.feeMinor,
        totalMinor: data.order.totalMinor,
        status: data.order.status,
        createdAt: data.order.createdAt,
        paidAt: data.order.paidAt,
        lines: quote.lines,
        taxMode: quote.taxMode ?? null,
      },
      buyer: { name: data.user.name, email: data.user.email, phone: data.user.phone },
      company,
      payment: data.payment
        ? {
            methodKey: data.payment.methodKey,
            methodNameAr: data.payment.nameAr ?? data.payment.methodKey,
            methodNameEn: data.payment.nameEn ?? data.payment.methodKey,
            reference: data.payment.reference,
          }
        : null,
      refunds: data.refunds,
    });
  }

  private async view(subscription: Subscription, plan: Plan, now: Date): Promise<SubscriptionView> {
    const pending = subscription.pendingChange
      ? pendingChangeSchema.safeParse(subscription.pendingChange)
      : null;
    const pendingKey = pending?.success ? await this.repo.planKey(pending.data.planId) : null;
    const nextGrant =
      subscription.status === "active" && subscription.source !== "trial"
        ? anniversaries(subscription.currentPeriodStart, subscription.currentPeriodEnd).find(
            (at) => at.getTime() > now.getTime(),
          )
        : undefined;
    return {
      id: subscription.id,
      plan: { key: plan.key, nameAr: plan.nameAr, nameEn: plan.nameEn },
      status: subscription.status,
      source: subscription.source,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      monthsPaid: subscription.monthsPaid,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      graceUntil: subscription.graceUntil?.toISOString() ?? null,
      pendingChange:
        pending?.success && pendingKey
          ? {
              planKey: pendingKey,
              months: pending.data.months,
              effectiveAt: pending.data.effectiveAt,
            }
          : null,
      nextCreditGrantAt: nextGrant?.toISOString() ?? null,
    };
  }

  private async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof SubscriptionsError)) throw error;
      switch (error.reason) {
        case "not_found":
        case "no_live_subscription":
          throw new AppError(ErrorCode.NOT_FOUND, { cause: error });
        case "trial_used":
          throw new AppError(ErrorCode.TRIAL_USED, { cause: error });
        case "phone_required":
          throw new AppError(ErrorCode.PHONE_VERIFICATION_REQUIRED, { cause: error });
        default:
          throw new AppError(ErrorCode.TRIAL_UNAVAILABLE, { cause: error });
      }
    }
  }
}
