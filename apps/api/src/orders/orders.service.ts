import { Inject, Injectable, Logger } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { QuoteService } from "../billing/quote.service.js";
import { API_ENV } from "../config/config.module.js";
import { OrgsService } from "../orgs/orgs.service.js";
import { GatewayRegistry } from "../payments/gateway-registry.js";
import { PaymentsRepo } from "../payments/payments.repo.js";
import { PaymentsService, toAppError } from "../payments/payments.service.js";
import { SettingsService } from "../settings/settings.service.js";

import type { ApiEnv } from "../config/env.js";
import type { Order, Payment, WalletOwner } from "@wasfa/db";
import type { PriceQuote } from "@wasfa/shared/price-engine";
import type {
  CreateOrderInput,
  CreateOrderResponse,
  OrderStatusResponse,
} from "@wasfa/shared/schemas/billing";

const HOUR_MS = 3_600_000;

/** Money taken off the list price: discount, deal and proration lines (all negative). */
function discountMinor(quote: PriceQuote): number {
  return quote.lines
    .filter((line) => line.kind === "discount" || line.kind === "proration")
    .reduce((sum, line) => sum - line.amountMinor, 0);
}

function paymentView(payment: Payment): NonNullable<CreateOrderResponse["payment"]> {
  return {
    id: payment.id,
    reference: payment.reference,
    methodKey: payment.methodKey,
    status: payment.status,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
  };
}

/**
 * Checkout (BILLING §5.1–§5.4). An order is made only from a stored, signed quote of the same
 * user, never from numbers the client sends; the order keeps the quote and its hash.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly quotes: QuoteService,
    private readonly repo: PaymentsRepo,
    private readonly payments: PaymentsService,
    private readonly gateways: GatewayRegistry,
    private readonly settings: SettingsService,
    private readonly orgs: OrgsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async create(
    userId: string,
    input: CreateOrderInput,
    now = new Date(),
  ): Promise<CreateOrderResponse> {
    const checkout = await this.quotes.loadForCheckout(input.quoteId, userId);
    if (!checkout || Date.parse(checkout.quote.expiresAt) <= now.getTime()) {
      throw new AppError(ErrorCode.QUOTE_EXPIRED);
    }
    const { quote, target, hash } = checkout;
    // An organization's order is made by its org_admin, from a quote made for that organization.
    if ((input.orgId ?? null) !== checkout.orgId) throw new AppError(ErrorCode.QUOTE_EXPIRED);
    if (checkout.orgId !== null) await this.orgs.authorize(userId, checkout.orgId, "org_admin");
    const owner: WalletOwner = checkout.orgId
      ? { type: "org", id: checkout.orgId }
      : { type: "user", id: userId };

    // The fee depends on the method: a quote priced for another method (or none) is re-quoted.
    let method: { key: string; gateway: string | null } | null = null;
    if (quote.totalMinor > 0) {
      if (!input.methodKey || quote.methodKey !== input.methodKey) {
        throw new AppError(ErrorCode.QUOTE_EXPIRED);
      }
      const row = await this.repo.enabledMethod(input.methodKey);
      if (!row) throw new AppError(ErrorCode.METHOD_NOT_AVAILABLE);
      const gateway = row.kind === "gateway" ? row.provider : null;
      if (gateway && !(await this.gateways.get(gateway))) {
        throw new AppError(ErrorCode.METHOD_NOT_AVAILABLE);
      }
      method = { key: row.key, gateway };
    }

    const billing = await this.settings.get("billing");
    // Checked and claimed: from here on this request owns the quote, a concurrent twin gets 409.
    if (!(await this.quotes.claim(input.quoteId))) throw new AppError(ErrorCode.QUOTE_EXPIRED);
    const created = await this.repo
      .createOrder(
        {
          owner,
          kind: target.kind,
          planId: target.planId,
          packId: target.packId,
          months: target.months,
          currency: quote.currency,
          quote: quote as unknown as Record<string, unknown>,
          quoteHash: hash,
          subtotalMinor: quote.subtotalMinor,
          discountMinor: discountMinor(quote),
          taxMinor: quote.taxMinor,
          feeMinor: quote.feeMinor,
          totalMinor: quote.totalMinor,
          applied: quote.applied,
          expiresAt: new Date(now.getTime() + billing.orderTtlHours * HOUR_MS),
          method,
        },
        this.payments.hooks,
        now,
      )
      .catch(toAppError);

    const { order } = created;
    let payment = created.payment;
    let redirectUrl: string | null = null;
    if (payment && method?.gateway) {
      ({ payment, redirectUrl } = await this.startCheckout(
        order,
        payment,
        method.gateway,
        input.locale,
      ));
    }
    return {
      orderId: order.id,
      orderNumber: order.number,
      status: order.status,
      redirectUrl,
      payment: payment ? paymentView(payment) : null,
    };
  }

  /** `GET /billing/orders/:id`: read only. The return page polls this; it never marks anything paid. */
  async status(userId: string, orderId: string): Promise<OrderStatusResponse> {
    const order = await this.findOrder(userId, orderId);
    const attempts = await this.repo.orderPayments(order.id);
    return {
      id: order.id,
      number: order.number,
      kind: order.kind,
      status: order.status,
      currency: order.currency,
      totalMinor: order.totalMinor,
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      payments: attempts.map((payment) => ({
        id: payment.id,
        reference: payment.reference,
        methodKey: payment.methodKey,
        status: payment.status,
        failureCode: payment.failureCode,
        rejectReason: payment.rejectReason,
        submissionsLeft: Math.max(0, 3 - payment.proofSubmissions),
        createdAt: payment.createdAt.toISOString(),
      })),
    };
  }

  async cancel(userId: string, orderId: string): Promise<OrderStatusResponse> {
    const order = await this.findOrder(userId, orderId);
    await this.repo.cancelOrder(order.id).catch(toAppError);
    return this.status(userId, orderId);
  }

  /** The caller's own order, or one of an organization they are an org_admin of; anything else is `NOT_FOUND`. */
  private async findOrder(userId: string, orderId: string): Promise<Order> {
    const own = await this.repo.userOrder(userId, orderId);
    if (own) return own;
    const orgId = await this.repo.orderOrgId(orderId);
    if (orgId !== null) {
      try {
        await this.orgs.authorize(userId, orgId, "org_admin");
        const order = await this.repo.orgOrder(orgId, orderId);
        if (order) return order;
      } catch {
        // A member without the role looks exactly like a stranger.
      }
    }
    throw new AppError(ErrorCode.NOT_FOUND);
  }

  private async startCheckout(
    order: Order,
    payment: Payment,
    gatewayKey: string,
    locale: "ar" | "en",
  ): Promise<{ payment: Payment; redirectUrl: string }> {
    const gateway = await this.gateways.get(gatewayKey);
    const web = this.env.WEB_ORIGIN[0] ?? "";
    try {
      if (!gateway) throw new Error("gateway disappeared");
      const checkout = await gateway.createCheckout({
        paymentId: payment.id,
        orderNumber: order.number,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        returnUrl: `${web}/billing/orders/${order.id}`,
        webhookUrl: `${this.env.API_PUBLIC_URL}/webhooks/${gatewayKey}`,
        locale,
      });
      const attached = await this.repo.attachCheckout(payment.id, checkout.providerRef);
      return { payment: attached, redirectUrl: checkout.redirectUrl };
    } catch (cause) {
      // The order stays open: the customer can pick another method on the same order page.
      await this.repo.transition(payment.id, "failed", {
        failureCode: "checkout_unavailable",
        reason: "checkout_unavailable",
      });
      this.logger.warn({
        event: "payments.checkout_failed",
        gateway: gatewayKey,
        orderId: order.id,
      });
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
    }
  }
}
