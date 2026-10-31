import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode, isAppError } from "@wasfa/shared/errors";
import { formatMoney } from "@wasfa/shared/money";
import {
  WA_AGENT_ORDER_TTL_SECONDS,
  waAgentOrderKey,
  WA_AGENT_DOCUMENT_MIMES,
  WA_AGENT_IMAGE_MIMES,
} from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { QuoteInputsRepo } from "../../billing/quote-inputs.repo.js";
import { QuoteService } from "../../billing/quote.service.js";
import { REDIS } from "../../common/redis.js";
import { FilesService } from "../../files/files.service.js";
import { OrdersService } from "../../orders/orders.service.js";
import { ManualPaymentsService } from "../../payments/manual/manual-payments.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";

import { WaAgentCommerceRepo, type OrderWithPayment } from "./agent-commerce.repo.js";
import { cairoStamp } from "./agent-discount.service.js";

import type { AgentCall, AgentToolResult } from "../agent/tools/tool.js";
import type { PlanQuoteRequest, QuoteResponse } from "@wasfa/shared/schemas/billing";

/** A receipt must be this fresh: an older picture is probably not the transfer being discussed. */
const RECEIPT_WINDOW_MS = 30 * 60 * 1_000;
/** How long the tool waits for the worker to process the copied receipt before it asks to retry. */
const PROCESSING_WAIT_MS = 30_000;
const PROCESSING_POLL_MS = 1_000;

const declined = (reason: string, extra: AgentToolResult = {}): AgentToolResult => ({
  started: false,
  reason,
  ...extra,
});

/**
 * `start_subscription` and `attach_receipt` (docs/WA-AGENT.md section 4): orders by manual bank
 * transfer through the normal checkout services, and the customer's receipt into the human review
 * queue. Nothing here approves, prices or activates anything: the amount is the quote engine's, the
 * decision is an admin's.
 */
@Injectable()
export class AgentSubscriptionService {
  constructor(
    private readonly commerce: WaAgentCommerceRepo,
    private readonly quoteRepo: QuoteInputsRepo,
    private readonly quotes: QuoteService,
    private readonly orders: OrdersService,
    private readonly manual: ManualPaymentsService,
    private readonly files: FilesService,
    private readonly conversations: WaAgentRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentSubscription");
  }

  async start(
    call: AgentCall,
    input: { planKey: string; months: number; couponCode?: string | undefined },
  ): Promise<AgentToolResult> {
    const user = await this.commerce.user(call.userId);
    if (user?.status !== "active") return declined("account_unavailable");
    const method = await this.commerce.bankMethod(call.market.currency, call.market.country);
    if (!method) return declined("no_bank_method");
    const plan = await this.quoteRepo.publicPlan(input.planKey, call.now);
    if (!plan || plan.audience === "organization") return declined("plan_not_found");

    const request: PlanQuoteRequest = {
      planKey: plan.key,
      months: input.months,
      methodKey: method.key,
      ...(input.couponCode === undefined ? {} : { couponCode: input.couponCode }),
    };
    let quoted: QuoteResponse;
    try {
      quoted = await this.quotes.quote(
        call.userId,
        request,
        call.market,
        `wa-agent:${call.userId}`,
        call.now,
      );
    } catch (error) {
      if (isAppError(error)) return declined("price_unavailable");
      throw error;
    }
    // A coupon that does not work never blocks the order: the quote already holds the full price.
    const couponStatus = quoted.coupon?.status;
    const couponApplied = couponStatus === "applied";
    const total = quoted.quote.totalMinor;

    const open = await this.commerce.openOrders(
      call.userId,
      plan.id,
      input.months,
      method.key,
      call.now,
    );
    // The same plan, period, price and coupon: it is the same purchase, so hand back that order.
    const existing = open.find(
      (row) =>
        row.order.totalMinor === total &&
        (row.order.applied["couponId"] ?? null) === (quoted.quote.applied.couponId ?? null),
    );
    let orderId = existing?.order.id;
    if (orderId === undefined) {
      try {
        const created = await this.orders.create(
          call.userId,
          { quoteId: quoted.quoteId, methodKey: method.key, locale: "ar" },
          call.now,
        );
        if (created.payment === null) {
          // A free order is active already; there is nothing to transfer.
          return { started: true, free: true, orderRef: created.orderNumber, amountMinor: 0 };
        }
        orderId = created.orderId;
      } catch (error) {
        if (isAppError(error)) return declined(orderFailureReason(error));
        throw error;
      }
    }
    const instructions = await this.manual.instructions(call.userId, orderId);
    await this.redis.set(
      waAgentOrderKey(call.conversationId),
      orderId,
      "EX",
      WA_AGENT_ORDER_TTL_SECONDS,
    );
    this.logger.info(
      { conversationId: call.conversationId, orderId, reused: existing !== undefined },
      "Agent subscription order ready",
    );
    const order =
      existing?.order ?? (await this.commerce.orderWithPayment(call.userId, orderId))?.order;
    return {
      started: true,
      reused: existing !== undefined,
      orderRef: order?.number,
      planName: plan.nameAr,
      months: input.months,
      amountMinor: instructions.amountMinor,
      currency: instructions.currency,
      formatted: formatMoney(instructions.amountMinor, instructions.currency, "ar"),
      couponApplied,
      ...(input.couponCode !== undefined && !couponApplied
        ? { couponRejected: couponStatus ?? "invalid" }
        : {}),
      instructions: {
        bankName: instructions.method.nameAr,
        accountName: instructions.accountHolder,
        account: instructions.accountDisplay,
        reference: instructions.reference,
        notes: instructions.instructionsAr,
      },
      expiresAt: instructions.expiresAt,
      expiresAtCairo: cairoStamp(new Date(instructions.expiresAt)),
      reviewWithinMinutes: instructions.reviewSlaMinutes,
    };
  }

  async attachReceipt(call: AgentCall): Promise<AgentToolResult> {
    const [media] = await this.commerce.newestUnusedMedia(
      call.conversationId,
      ["image", "document"],
      new Date(call.now.getTime() - RECEIPT_WINDOW_MS),
      "attachedAs",
      1,
    );
    const mime = media?.mediaMime;
    const accepted =
      mime !== undefined &&
      ([...WA_AGENT_IMAGE_MIMES, ...WA_AGENT_DOCUMENT_MIMES] as readonly string[]).includes(mime);
    if (!media || !accepted) return { attached: false, reason: "no_receipt_found" };

    const target = await this.proofTarget(call);
    if (!target) return { attached: false, reason: "no_pending_payment" };
    // First claim wins: the same picture can never be attached twice, even by two quick calls.
    if (!(await this.commerce.claimMedia(media.id, "attachedAs"))) {
      return { attached: false, reason: "no_receipt_found" };
    }

    const viewer = { id: call.userId, orgIds: [] };
    try {
      const fileId = await this.files.importObject(viewer, {
        sourceKey: media.mediaKey,
        purpose: "payment_proof",
        mime: media.mediaMime as (typeof WA_AGENT_IMAGE_MIMES)[number] | "application/pdf",
        bytes: media.mediaBytes,
      });
      const status = await this.files.awaitProcessed(viewer, fileId, {
        timeoutMs: PROCESSING_WAIT_MS,
        pollMs: PROCESSING_POLL_MS,
      });
      if (status === "rejected") {
        await this.commerce.releaseMedia(media.id, "attachedAs");
        return { attached: false, reason: "unreadable_receipt" };
      }
      if (status !== "processed") {
        await this.commerce.releaseMedia(media.id, "attachedAs");
        return { attached: false, reason: "still_processing" };
      }
      const conversation = await this.conversations.find(call.conversationId);
      await this.manual.submit(call.userId, target.payment.id, {
        // The customer's receipt carries no transaction id we can read; this one is unique per payment
        // and tells the reviewer the proof came from WhatsApp (the picture holds the real reference).
        txnId: `WA-${target.payment.reference}`.toUpperCase(),
        senderPhone: (conversation?.phone ?? "").replace(/^\+/, "") || "0000000000",
        fileId,
      });
      await this.commerce.setMediaMeta(media.id, {
        attachedAs: { fileId, paymentId: target.payment.id },
      });
      const method = await this.commerce.method(target.payment.methodKey);
      const billing = await this.settings.get("billing");
      this.logger.info(
        { conversationId: call.conversationId, paymentId: target.payment.id },
        "Agent receipt attached",
      );
      return {
        attached: true,
        orderRef: target.order.number,
        reviewWithinMinutes: method?.reviewSlaMinutes ?? billing.reviewSlaMinutes,
      };
    } catch (error) {
      await this.commerce.releaseMedia(media.id, "attachedAs");
      if (isAppError(error)) return { attached: false, reason: receiptFailureReason(error) };
      throw error;
    }
  }

  /** The order the agent opened for this chat, else the user's newest payment that still takes a proof. */
  private async proofTarget(call: AgentCall): Promise<OrderWithPayment | null> {
    const remembered = await this.redis.get(waAgentOrderKey(call.conversationId));
    if (remembered !== null) {
      const row = await this.commerce.orderWithPayment(call.userId, remembered);
      if (
        row &&
        row.order.status === "pending_payment" &&
        (row.payment.status === "awaiting_customer" || row.payment.status === "rejected")
      ) {
        return row;
      }
    }
    return this.commerce.newestProofTarget(call.userId, call.now);
  }
}

function orderFailureReason(error: AppError): string {
  switch (error.code) {
    case ErrorCode.COUPON_UNAVAILABLE:
      return "coupon_unavailable";
    case ErrorCode.METHOD_NOT_AVAILABLE:
      return "no_bank_method";
    case ErrorCode.QUOTE_EXPIRED:
      return "quote_expired";
    default:
      return "order_failed";
  }
}

function receiptFailureReason(error: AppError): string {
  switch (error.code) {
    case ErrorCode.PROOF_LIMIT:
      return "proof_limit";
    case ErrorCode.PROOF_NOT_ALLOWED:
      return "proof_not_allowed";
    case ErrorCode.PROOF_PROCESSING:
      return "still_processing";
    case ErrorCode.DUPLICATE_TXN:
      return "duplicate";
    case ErrorCode.RATE_LIMITED:
      return "rate_limited";
    case ErrorCode.NOT_FOUND:
      return "no_pending_payment";
    default:
      return "attach_failed";
  }
}
