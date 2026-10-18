import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import {
  codeListQuerySchema,
  createCodeSchema,
  growthIdParamSchema,
  reasonBodySchema,
} from "@wasfa/shared/schemas/admin-growth";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminReferralCodesService } from "./admin-referral-codes.service.js";

class ListDto extends createZodDto(codeListQuerySchema) {}
class CreateDto extends createZodDto(createCodeSchema) {}
class IdDto extends createZodDto(growthIdParamSchema) {}
class ReasonDto extends createZodDto(reasonBodySchema) {}

/** Partner, organization and campaign codes (Task 3.13; REFERRALS §2). */
@Controller("admin/growth/codes")
export class AdminReferralCodesController {
  constructor(private readonly codes: AdminReferralCodesService) {}

  @Get()
  @RequirePermission("referrals.read")
  @RateLimit(120)
  list(@Query() query: ListDto) {
    return this.codes.list(query);
  }

  @Post()
  @RequirePermission("referrals.write")
  @RateLimit(30)
  @Audited({ action: "referral_code.created", targetType: "referral_code" })
  create(
    @Body() body: CreateDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.codes.create(body, user, audit);
  }

  @Post(":id/pause")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RateLimit(30)
  @Audited({ action: "referral_code.paused", targetType: "referral_code" })
  pause(@Param() params: IdDto, @Body() body: ReasonDto, @AuditCtx() audit: AuditScope) {
    return this.codes.setActive(params.id, false, body.reason, audit);
  }

  @Post(":id/resume")
  @HttpCode(200)
  @RequirePermission("referrals.write")
  @RateLimit(30)
  @Audited({ action: "referral_code.resumed", targetType: "referral_code" })
  resume(@Param() params: IdDto, @Body() body: ReasonDto, @AuditCtx() audit: AuditScope) {
    return this.codes.setActive(params.id, true, body.reason, audit);
  }
}
