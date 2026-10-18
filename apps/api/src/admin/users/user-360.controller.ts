import { Body, Controller, Get, HttpCode, Param, Post, Query, UseInterceptors } from "@nestjs/common";
import {
  adminRevealContactSchema,
  adminUserPageQuerySchema,
  adminUserParamsSchema,
} from "@wasfa/shared/schemas/admin-user-360";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { NoStoreInterceptor } from "./no-store.interceptor.js";
import { AdminUser360Service } from "./user-360.service.js";

class UserParamsDto extends createZodDto(adminUserParamsSchema) {}
class PageQueryDto extends createZodDto(adminUserPageQuerySchema) {}
class RevealContactDto extends createZodDto(adminRevealContactSchema) {}

/** User 360 (Task 3.15): the tabs that need no health permission. */
@Controller("admin/users/:id")
export class AdminUser360Controller {
  constructor(private readonly user360: AdminUser360Service) {}

  @Get("summary")
  @RequirePermission("users.read")
  @RateLimit(120)
  summary(@Param() params: UserParamsDto) {
    return this.user360.summary(params.id);
  }

  @Post("reveal-contact")
  @HttpCode(200)
  @RequirePermission("users.read")
  @RateLimit(20)
  @UseInterceptors(NoStoreInterceptor)
  @Audited({ action: "user.contact_revealed", targetType: "user" })
  async revealContact(
    @Param() params: UserParamsDto,
    @Body() body: RevealContactDto,
    @AuditCtx() audit: AuditScope,
  ) {
    const value = await this.user360.contactValue(params.id, body.field);
    // The value itself is never audited: which field was opened, and why, is.
    audit.after = { field: body.field, reason: body.reason };
    return { field: body.field, value };
  }

  @Get("timeline")
  @RequirePermission("users.read")
  @RateLimit(120)
  timeline(@Param() params: UserParamsDto, @Query() query: PageQueryDto) {
    return this.user360.timeline(params.id, query);
  }

  @Get("billing")
  @RequirePermission("billing.read")
  @RateLimit(120)
  billing(@Param() params: UserParamsDto, @Query() query: PageQueryDto) {
    return this.user360.billing(params.id, query);
  }

  @Get("credits")
  @RequirePermission("users.read", "usage.read")
  @RateLimit(120)
  credits(@Param() params: UserParamsDto, @Query() query: PageQueryDto) {
    return this.user360.creditsView(params.id, query);
  }

  @Get("referrals")
  @RequirePermission("referrals.read")
  @RateLimit(120)
  referrals(@Param() params: UserParamsDto, @Query() query: PageQueryDto) {
    return this.user360.referralsView(params.id, query);
  }
}
