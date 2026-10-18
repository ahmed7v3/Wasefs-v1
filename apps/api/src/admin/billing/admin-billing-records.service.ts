import { Inject, Injectable } from "@nestjs/common";
import { refundSubscriptionEffect } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { buildReceipt, maskEmail, maskPhone } from "@wasfa/shared/subscriptions";

import { API_ENV } from "../../config/config.module.js";
import { EmailQueue } from "../../notifications/email-queue.js";
import { PaymentsService } from "../../payments/payments.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { decodeCursor, toPage } from "../common/keyset.js";

import { maskName, maskTail } from "./admin-billing-console.mask.js";
import { AdminBillingRecordsRepo } from "./admin-billing-records.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { ApiEnv } from "../../config/env.js";
import type {
  AdminRefundInput,
  OrderListQuery,
  PaymentListQuery,
  RefundListQuery,
} from "@wasfa/shared/schemas/admin-billing-console";

const PAID_ORDER_STATUSES: readonly string[] = ["paid", "partially_refunded", "refunded"];
const REFUNDABLE_PAYMENT_STATUSES: readonly string[] = ["succeeded", "partially_refunded"];

@Injectable()
export class AdminBillingRecordsService {
  constructor(
    private readonly repo: AdminBillingRecordsRepo,
    private readonly settings: SettingsService,
    private readonly emails: EmailQueue,
    private readonly payments: PaymentsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // --- Payments ---------------------------------------------------------------------------------

  async listPayments(query: PaymentListQuery) {
    const rows = await this.repo.listPayments(query, decodeCursor(query.cursor, "uuid"));
    const page = toPage(rows, query.limit, (row) => ({ at: row.at, key: row.id }));
    const now = Date.now();
    return {
      items: page.items.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        reference: row.reference,
        customer: {
          type: row.ownerUserId ? ("user" as const) : ("org" as const),
          id: row.ownerUserId ?? row.ownerOrgId ?? row.orderId,
          name: row.userName ?? row.orgName,
          maskedPhone: row.userPhone ? maskPhone(row.userPhone) : null,
        },
        planKey: row.planKey,
        packKey: row.packKey,
        months: row.months,
        methodKey: row.methodKey,
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        ageSeconds: Math.max(0, Math.floor((now - row.createdAt.getTime()) / 1000)),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async paymentRecord(id: string) {
    const row = await this.repo.paymentRecord(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const { payment, order, user } = row;
    const quoteLines = Array.isArray(order.quote.lines) ? (order.quote.lines as unknown[]) : [];
    return {
      id: payment.id,
      payment: {
        id: payment.id,
        reference: payment.reference,
        status: payment.status,
        methodKey: payment.methodKey,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        txnIdMasked: maskTail(payment.txnId),
        senderPhoneMasked: payment.senderPhoneMasked,
        createdAt: payment.createdAt.toISOString(),
        hasProof: payment.hasProof,
        flags: payment.flags,
      },
      order: {
        id: order.id,
        number: order.number,
        kind: order.kind,
        planKey: row.planKey,
        packKey: row.packKey,
        months: order.months,
        status: order.status,
        quoteLines,
        totals: {
          subtotalMinor: order.subtotalMinor,
          discountMinor: order.discountMinor,
          taxMinor: order.taxMinor,
          feeMinor: order.feeMinor,
          totalMinor: order.totalMinor,
        },
        applied: order.applied,
      },
      timeline: row.events.map((event) => ({
        type: event.type,
        time: event.time.toISOString(),
        signatureOk: event.signatureOk,
      })),
      refunds: row.refunds.map((refund) => ({
        id: refund.id,
        amountMinor: refund.amountMinor,
        currency: refund.currency,
        status: refund.status,
        createdAt: refund.createdAt.toISOString(),
      })),
      customer: {
        type: order.ownerUserId ? ("user" as const) : ("org" as const),
        id: order.ownerUserId ?? order.ownerOrgId ?? order.id,
        name: user?.name ?? row.orgName,
        maskedPhone: user?.phone ? maskPhone(user.phone) : null,
        maskedEmail: user?.email ? maskEmail(user.email) : null,
        previousPaidOrders: row.previousPaidOrders,
        currentPlanKey: row.currentPlanKey,
        referralSourceCode: row.referralSourceCode,
      },
      flags: payment.flags,
    };
  }

  // --- Orders ------------------------------------------------------------------------------------

  async listOrders(query: OrderListQuery) {
    const rows = await this.repo.listOrders(query, decodeCursor(query.cursor, "uuid"));
    const page = toPage(rows, query.limit, (row) => ({ at: row.at, key: row.id }));
    return {
      items: page.items.map((row) => ({
        id: row.id,
        number: row.number,
        kind: row.kind,
        planKey: row.planKey,
        packKey: row.packKey,
        owner: {
          type: row.ownerUserId ? ("user" as const) : ("org" as const),
          id: row.ownerUserId ?? row.ownerOrgId ?? row.id,
          label: maskName(row.userName ?? row.orgName),
        },
        status: row.status,
        subtotalMinor: row.subtotalMinor,
        totalMinor: row.totalMinor,
        currency: row.currency,
        createdAt: row.createdAt.toISOString(),
        paidAt: row.paidAt?.toISOString() ?? null,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async orderDetail(id: string) {
    const row = await this.repo.orderDetail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const { order } = row;
    // The payment that actually settled the order names the method on the receipt.
    const settled =
      row.payments.find((payment) =>
        ["succeeded", "partially_refunded", "refunded"].includes(payment.status),
      ) ?? row.payments[0];
    const quote = order.quote as { lines?: unknown; taxMode?: "added" | "inclusive" | null };
    const receipt = PAID_ORDER_STATUSES.includes(order.status)
      ? buildReceipt({
          order: {
            number: order.number,
            kind: order.kind,
            planKey: row.planKey,
            packKey: row.packKey,
            months: order.months,
            currency: order.currency,
            subtotalMinor: order.subtotalMinor,
            discountMinor: order.discountMinor,
            taxMinor: order.taxMinor,
            feeMinor: order.feeMinor,
            totalMinor: order.totalMinor,
            status: order.status,
            createdAt: order.createdAt,
            paidAt: order.paidAt,
            lines: quote.lines,
            taxMode: quote.taxMode ?? null,
          },
          buyer: {
            name: row.buyer?.name ?? row.orgName ?? "",
            email: row.buyer?.email ?? null,
            phone: row.buyer?.phone ?? null,
          },
          company: (await this.settings.get("billing")).company,
          payment: settled
            ? {
                methodKey: settled.methodKey,
                methodNameAr: settled.methodNameAr ?? settled.methodKey,
                methodNameEn: settled.methodNameEn ?? settled.methodKey,
                reference: settled.reference,
              }
            : null,
          refunds: row.refunds,
        })
      : null;
    return {
      id: order.id,
      number: order.number,
      status: order.status,
      kind: order.kind,
      planKey: row.planKey,
      packKey: row.packKey,
      months: order.months,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      feeMinor: order.feeMinor,
      totalMinor: order.totalMinor,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      receipt,
      payments: row.payments.map((payment) => ({
        id: payment.id,
        reference: payment.reference,
        methodKey: payment.methodKey,
        status: payment.status,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        createdAt: payment.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Queues the same `payment_receipt` mail the `billing.order_paid` handler sends, without
   * replaying the topic (that would add a second in-app notification). The job id folds the minute,
   * so repeated clicks inside one minute collapse into one mail.
   */
  async resendReceipt(id: string) {
    const row = await this.repo.orderDetail(id);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    const { order, buyer } = row;
    if (!PAID_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "order_not_paid" } });
    }
    if (!buyer?.email || buyer.status === "deleted") {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "receipt_unavailable" } });
    }
    const origin = this.env.WEB_ORIGIN[0];
    if (!origin) throw new AppError(ErrorCode.INTERNAL);
    const minute = Math.floor(Date.now() / 60_000);
    await this.emails.sendPaymentReceipt(
      {
        to: buyer.email,
        name: buyer.name,
        locale: buyer.locale,
        orderNumber: order.number,
        totalMinor: order.totalMinor,
        currency: order.currency,
        taxAndFeesMinor: order.taxMinor + order.feeMinor,
        link: new URL(`/billing/orders/${order.id}`, origin).toString(),
      },
      `receipt-${order.id}-${String(minute)}`,
    );
    return { queued: true };
  }

  // --- Refunds -----------------------------------------------------------------------------------

  async listRefunds(query: RefundListQuery) {
    const rows = await this.repo.listRefunds(
      query.limit,
      decodeCursor(query.cursor, "uuid"),
      query.status,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.at, key: row.id }));
    return {
      items: page.items.map((row) => ({
        id: row.id,
        paymentId: row.paymentId,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        amountMinor: row.amountMinor,
        currency: row.currency,
        status: row.status,
        reason: row.reason,
        transferReference: row.transferReference,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * What a refund of `amountMinor` would do, computed by the same pure function the refund
   * transaction runs, so the numbers shown are the numbers applied.
   */
  async refundPreview(paymentId: string, amountMinor: number) {
    const row = await this.repo.refundPreviewData(paymentId);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    if (!REFUNDABLE_PAYMENT_STATUSES.includes(row.payment.status)) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_refundable" } });
    }
    const paidMinor = row.payment.amountMinor;
    const refundableMinor = Math.max(0, paidMinor - row.alreadyRefundedMinor);
    if (amountMinor > refundableMinor) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["amountMinor"] } });
    }
    const full = row.alreadyRefundedMinor + amountMinor >= paidMinor;

    // Only credits still in the wallet can be taken back.
    const unspent = Math.min(row.creditsGranted, row.balance);
    const creditsUsed = row.creditsGranted - unspent;
    const maxClawback = Math.min(row.creditsGranted - creditsUsed, row.balance);

    let subscription: {
      id: string;
      planKey: string | null;
      effect: "ends_now" | "shortened" | "downgrade_removed" | "unchanged";
      newPeriodEnd: string | null;
    } | null = null;
    if (row.subscription) {
      const outcome = refundSubscriptionEffect(row.subscription, row.order, full, new Date(), {
        conflictingDowngrade: row.conflictingDowngrade,
      });
      subscription = {
        id: row.subscription.id,
        planKey: row.planKey,
        effect: outcome.effect,
        newPeriodEnd: outcome.effect === "unchanged" ? null : outcome.newPeriodEnd.toISOString(),
      };
    }
    return {
      paidMinor,
      alreadyRefundedMinor: row.alreadyRefundedMinor,
      refundableMinor,
      full,
      currency: row.payment.currency,
      subscription,
      creditsGranted: row.creditsGranted,
      creditsUsed,
      maxClawback,
      // Rewards are reversed by the rewards engine (Task 3.10); nothing to reverse here yet.
      rewardsToReverse: 0,
      couponKept: true,
    };
  }

  async refund(paymentId: string, actor: AuthenticatedUser, input: AdminRefundInput) {
    const owner = await this.repo.paymentOwner(paymentId);
    if (!owner) throw new AppError(ErrorCode.NOT_FOUND);
    // The review rule applies to refunds too: nobody refunds money paid from their own account.
    if (owner.userId === actor.id || (owner.orgId !== null && actor.orgIds.includes(owner.orgId))) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "own_payment" } });
    }
    const preview = await this.refundPreview(paymentId, input.amountMinor);
    if (input.clawbackCredits > preview.maxClawback) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["clawbackCredits"] } });
    }
    const refund = await this.payments.refund({
      paymentId,
      actorId: actor.id,
      amountMinor: input.amountMinor,
      reason: input.reason,
      transferReference: input.transferReference,
      clawbackCredits: input.clawbackCredits,
    });
    return {
      id: refund.id,
      status: refund.status,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      preview,
    };
  }
}
