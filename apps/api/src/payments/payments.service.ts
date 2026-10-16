import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  PaymentsError,
  type PaymentHooks,
  type ProviderEventOutcome,
  type Refund,
} from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { GatewaySignatureError } from "@wasfa/shared/gateways";

import { GatewayRegistry } from "./gateway-registry.js";
import { PaymentsRepo } from "./payments.repo.js";

/** What activation and refunds call in the subscription domain; Task 3.5 binds the real one. */
export const PAYMENT_HOOKS = Symbol("PAYMENT_HOOKS");

/** Turns the domain's expected refusals into API errors; anything else stays a 500. */
export function toAppError(error: unknown): never {
  if (error instanceof PaymentsError) {
    switch (error.reason) {
      case "not_found":
        throw new AppError(ErrorCode.NOT_FOUND, { cause: error });
      case "coupon_unavailable":
        throw new AppError(ErrorCode.COUPON_UNAVAILABLE, { cause: error });
      case "illegal_transition":
      case "not_refundable":
      case "refund_exceeds_paid":
        throw new AppError(ErrorCode.CONFLICT, { cause: error, details: { reason: error.reason } });
    }
  }
  throw error;
}

export interface RefundInput {
  paymentId: string;
  amountMinor: number;
  reason: string;
  actorId: string;
  clawbackCredits: number;
  /** Manual methods: the reference of the transfer the admin made outside the app. */
  transferReference?: string;
}

/**
 * Payment-side operations shared by checkout, webhooks and (Task 3.8) the admin console. Every
 * state change goes through the `@wasfa/db` state machine; this service only adds the provider
 * calls around it.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly repo: PaymentsRepo,
    private readonly gateways: GatewayRegistry,
    @Inject(PAYMENT_HOOKS) readonly hooks: PaymentHooks,
  ) {}

  /**
   * `POST /webhooks/:gateway`. A delivery that fails verification is recorded and refused (401);
   * a verified one is always acknowledged, even when a business rule rejected it, so the provider
   * stops retrying — the rejection is recorded and alerted inside the transaction.
   */
  async handleWebhook(
    gatewayKey: string,
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<ProviderEventOutcome> {
    const gateway = await this.gateways.get(gatewayKey);
    if (!gateway) throw new AppError(ErrorCode.NOT_FOUND);
    let event;
    try {
      event = gateway.verifyWebhook(body, headers);
    } catch (error) {
      if (!(error instanceof GatewaySignatureError)) throw error;
      await this.repo.recordRejectedEvent(gatewayKey, { reason: "bad_signature" });
      this.logger.warn({ event: "payments.webhook_rejected", gateway: gatewayKey });
      throw new AppError(ErrorCode.INVALID_SIGNATURE);
    }
    const outcome = await this.repo.applyProviderEvent(
      {
        provider: gatewayKey,
        eventId: event.eventId,
        type: event.type,
        paymentId: event.paymentId,
        providerRef: event.providerRef,
        state: event.state,
        amountMinor: event.amountMinor,
        currency: event.currency,
        failureCode: event.failureCode,
        redacted: event.redacted,
      },
      this.hooks,
    );
    this.logger.log({ event: "payments.webhook", gateway: gatewayKey, outcome });
    return outcome;
  }

  /**
   * Refund of BILLING §7.4: recorded first, then the money goes back (gateway refund, or a manual
   * transfer the admin already made), then the effects apply in one transaction. A provider
   * refusal marks the refund failed and changes nothing else.
   */
  async refund(input: RefundInput): Promise<Refund> {
    const payment = await this.repo.payment(input.paymentId);
    if (!payment) throw new AppError(ErrorCode.NOT_FOUND);
    if (!payment.gateway && !input.transferReference) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { fields: ["transferReference"] },
      });
    }
    const refund = await this.repo
      .openRefund({
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        reason: input.reason,
        actorId: input.actorId,
        clawbackCredits: input.clawbackCredits,
      })
      .catch(toAppError);

    let providerRef: string | undefined;
    if (payment.gateway) {
      const gateway = await this.gateways.get(payment.gateway);
      if (!gateway?.refund || !payment.providerRef) {
        await this.repo.failRefund(refund.id);
        throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
      }
      try {
        ({ providerRef } = await gateway.refund({
          paymentId: payment.id,
          providerRef: payment.providerRef,
          amountMinor: input.amountMinor,
          currency: payment.currency,
          reason: input.reason,
        }));
      } catch (cause) {
        await this.repo.failRefund(refund.id);
        throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { cause });
      }
    }
    return this.repo
      .completeRefund(
        refund.id,
        {
          ...(providerRef ? { providerRef } : {}),
          ...(input.transferReference ? { transferReference: input.transferReference } : {}),
          clawbackCredits: input.clawbackCredits,
          actorId: input.actorId,
        },
        this.hooks,
      )
      .catch(toAppError);
  }
}
