import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  adminPaymentIdSchema,
  approveManualPaymentSchema,
  rejectManualPaymentSchema,
  requestProofSchema,
  reviewQuerySchema,
} from "@wasfa/shared/schemas/admin-manual-payments";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminBillingPaymentsService } from "./admin-billing-payments.service.js";

class IdDto extends createZodDto(adminPaymentIdSchema) {}
class QueryDto extends createZodDto(reviewQuerySchema) {}
class ApproveDto extends createZodDto(approveManualPaymentSchema) {}
class RejectDto extends createZodDto(rejectManualPaymentSchema) {}
class RequestProofDto extends createZodDto(requestProofSchema) {}

@Controller("admin/billing/payments")
export class AdminBillingPaymentsController {
  constructor(private readonly payments: AdminBillingPaymentsService) {}

  @Get("review")
  @RequirePermission("payments.review")
  @RateLimit(60)
  queue(@Query() query: QueryDto) {
    return this.payments.queue(query.limit, query.cursor);
  }

  @Get(":id")
  @RequirePermission("payments.review")
  @RateLimit(60)
  @Audited({ action: "payment.review_opened", targetType: "payment", targetParam: "id" })
  async detail(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    audit.targetId = params.id;
    return this.payments.detail(params.id);
  }

  @Post(":id/claim")
  @RequirePermission("payments.review")
  @RateLimit(30)
  @Audited({
    action: "payment.review_claimed",
    targetType: "payment",
    targetParam: "id",
    afterFromResponse: true,
  })
  claim(
    @Param() params: IdDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    return this.payments.claim(params.id, user);
  }

  @Post(":id/approve")
  @RequirePermission("payments.review")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "payment.approved",
    targetType: "payment",
    targetParam: "id",
    afterFromResponse: true,
  })
  approve(
    @Param() params: IdDto,
    @Body() body: ApproveDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    audit.after = { action: "approve" };
    return this.payments.approve(params.id, user, body.override, body.note);
  }

  @Post(":id/reject")
  @RequirePermission("payments.review")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "payment.rejected", targetType: "payment", targetParam: "id" })
  reject(
    @Param() params: IdDto,
    @Body() body: RejectDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    audit.after = { reason: body.reason };
    return this.payments.reject(params.id, user, { ...body, note: body.note });
  }

  @Post(":id/request-proof")
  @RequirePermission("payments.review")
  @RateLimit(10)
  @Audited({
    action: "payment.proof_requested",
    targetType: "payment",
    targetParam: "id",
    afterFromResponse: true,
  })
  requestProof(
    @Param() params: IdDto,
    @Body() body: RequestProofDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    return this.payments.requestProof(params.id, user, body.note, body.override);
  }
}
