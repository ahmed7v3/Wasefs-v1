import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  PaymentsError,
  type PaymentHooks,
  type ProviderEventOutcome,
  type Refund,
} from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { GATEWAY_TEST_ORDER_PREFIX, GatewaySignatureError } from "@wasfa/shared/gateways";

import { GatewayRegistry } from "./gateway-registry.js";
import { PaymentsRepo } from "./payments.repo.js";

/** What activation and refunds call in the subscription domain; Task 3.5 binds the real one. */
export const PAYMENT_HOOKS = Symbol("PAYMENT_HOOKS");

function candidateTestOrderId(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const data = (body as Record<string, unknown>).data;
  if (data === null || typeof data !== "object") return null;
  const id = (data as Record<string, unknown>).merchantOrderId;
  return typeof id === "string" && id.startsWith(GATEWAY_TEST_ORDER_PREFIX) ? id : null;
}

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
  /** Reference of the refund the owner already issued through the provider or transfer dashboard. */
  transferReference?: string;
}

/**
 * Payment-side operations shared by checkout, webhooks and (Task 3.8) the admin console. Every
 * state change goes through the `@wasfa/db` state machine. Provider calls are read-only.
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
    const gateway = await this.gateways.forAdmin(gatewayKey);
    if (!gateway) {
      if (!(await this.repo.configuredGateway(gatewayKey))) throw new AppError(ErrorCode.NOT_FOUND);
      await this.repo.recordWebhook(gatewayKey, false, "credentials_unavailable");
      throw new AppError(ErrorCode.UPSTREAM_UNAVAILABLE);
    }
    let event;
    try {
      event = gateway.verifyWebhook(body, headers);
    } catch (error) {
      if (!(error instanceof GatewaySignatureError)) throw error;
      // An unverified gwtest candidate must remain outside payment_events, even on bad signatures.
      if (candidateTestOrderId(body) === null) {
        await this.repo.recordRejectedEvent(gatewayKey, { reason: "bad_signature" });
      }
      await this.repo.recordWebhook(gatewayKey, false, "bad_signature");
      this.logger.warn({ event: "payments.webhook_rejected", gateway: gatewayKey });
      throw new AppError(ErrorCode.INVALID_SIGNATURE);
    }
    if (event.paymentId.startsWith(GATEWAY_TEST_ORDER_PREFIX)) {
      const recorded = await this.repo.recordGatewayTestWebhook({
        gatewayKey,
        providerOrderId: event.paymentId,
        state: event.state,
        amountMinor: event.amountMinor,
        currency: event.currency,
      });
      await this.repo.recordWebhook(gatewayKey, true, null);
      return recorded ? "test" : "ignored";
    }
    const outcome = await this.repo
      .applyProviderEvent(
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
      )
      .finally(() => this.repo.recordWebhook(gatewayKey, true, null));
    this.logger.log({ event: "payments.webhook", gateway: gatewayKey, outcome });
    return outcome;
  }

  /**
   * Refund of BILLING §7.4: the owner issues it externally and supplies its reference; this service
   * records that completed refund and applies the effects in one transaction. It never moves money.
   */
  async refund(input: RefundInput): Promise<Refund> {
    const payment = await this.repo.payment(input.paymentId);
    if (!payment) throw new AppError(ErrorCode.NOT_FOUND);
    if (!input.transferReference?.trim()) {
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

    return this.repo
      .completeRefund(
        refund.id,
        {
          transferReference: input.transferReference.trim(),
          clawbackCredits: input.clawbackCredits,
          actorId: input.actorId,
        },
        this.hooks,
      )
      .catch(toAppError);
  }
}
