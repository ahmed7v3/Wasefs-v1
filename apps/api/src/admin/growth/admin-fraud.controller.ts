import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { bulkFraudSchema, fraudListQuerySchema } from "@wasfa/shared/schemas/admin-growth";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminFraudService } from "./admin-fraud.service.js";

class ListDto extends createZodDto(fraudListQuerySchema) {}
class BulkDto extends createZodDto(bulkFraudSchema) {}

/** Fraud queue (Task 3.13; ADMIN-CONSOLE-SPEC §6.2). */
@Controller("admin/growth/fraud")
export class AdminFraudController {
  constructor(private readonly fraud: AdminFraudService) {}

  @Get()
  @RequirePermission("referrals.read")
  @RateLimit(120)
  list(@Query() query: ListDto) {
    return this.fraud.list(query);
  }

  @Post("bulk")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "referral.fraud_bulk", targetType: "referral_fraud_bulk" })
  bulk(
    @Body() body: BulkDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.fraud.bulk(body, user, audit);
  }
}
