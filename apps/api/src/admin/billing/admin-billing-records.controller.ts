import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  adminConsoleIdSchema,
  adminOrderListQuerySchema,
  adminPaymentListQuerySchema,
  adminRefundListQuerySchema,
  adminRefundPreviewSchema,
  adminRefundSchema,
} from "@wasfa/shared/schemas/admin-billing-console";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminBillingRecordsService } from "./admin-billing-records.service.js";

class IdDto extends createZodDto(adminConsoleIdSchema) {}
class PaymentQueryDto extends createZodDto(adminPaymentListQuerySchema) {}
class OrderQueryDto extends createZodDto(adminOrderListQuerySchema) {}
class RefundQueryDto extends createZodDto(adminRefundListQuerySchema) {}
class RefundPreviewDto extends createZodDto(adminRefundPreviewSchema) {}
class RefundDto extends createZodDto(adminRefundSchema) {}

@Controller("admin/billing")
export class AdminBillingRecordsController {
  constructor(private readonly records: AdminBillingRecordsService) {}

  @Get("payments")
  @RequirePermission("billing.read")
  @RateLimit(60)
  listPayments(@Query() query: PaymentQueryDto) {
    return this.records.listPayments(query);
  }

  @Get("payments/:id/record")
  @RequirePermission("billing.read")
  @RateLimit(60)
  @Audited({ action: "payment.record_opened", targetType: "payment", targetParam: "id" })
  paymentRecord(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    audit.targetId = params.id;
    return this.records.paymentRecord(params.id);
  }

  @Get("orders")
  @RequirePermission("billing.read")
  @RateLimit(60)
  listOrders(@Query() query: OrderQueryDto) {
    return this.records.listOrders(query);
  }

  @Get("orders/:id")
  @RequirePermission("billing.read")
  @RateLimit(60)
  orderDetail(@Param() params: IdDto) {
    return this.records.orderDetail(params.id);
  }

  @Post("orders/:id/resend-receipt")
  @RequirePermission("billing.write")
  @RateLimit(5)
  @Audited({ action: "order.receipt_resent", targetType: "order", targetParam: "id" })
  resendReceipt(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    audit.targetId = params.id;
    return this.records.resendReceipt(params.id);
  }

  @Get("refunds")
  @RequirePermission("billing.read")
  @RateLimit(60)
  listRefunds(@Query() query: RefundQueryDto) {
    return this.records.listRefunds(query);
  }

  @Post("payments/:id/refund/preview")
  @RequirePermission("payments.refund")
  @RateLimit(20)
  refundPreview(@Param() params: IdDto, @Body() body: RefundPreviewDto) {
    return this.records.refundPreview(params.id, body.amountMinor);
  }

  @Post("payments/:id/refund")
  @RequirePermission("payments.refund")
  @RequireFreshAuth(10)
  @RateLimit(5)
  @Audited({
    action: "payment.refunded",
    targetType: "payment",
    targetParam: "id",
  })
  refund(
    @Param() params: IdDto,
    @Body() body: RefundDto,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    audit.after = {
      amountMinor: body.amountMinor,
      clawbackCredits: body.clawbackCredits,
      transferReference: body.transferReference,
      reason: body.reason,
    };
    return this.records.refund(params.id, actor, body);
  }
}
