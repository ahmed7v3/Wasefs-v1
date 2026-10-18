import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  adminConsoleIdSchema,
  adminReasonSchema,
  adminSubscriptionExtendSchema,
  adminSubscriptionListQuerySchema,
} from "@wasfa/shared/schemas/admin-billing-console";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminBillingSubscriptionsService } from "./admin-billing-subscriptions.service.js";

class IdDto extends createZodDto(adminConsoleIdSchema) {}
class QueryDto extends createZodDto(adminSubscriptionListQuerySchema) {}
class ExtendDto extends createZodDto(adminSubscriptionExtendSchema) {}
class ReasonDto extends createZodDto(adminReasonSchema) {}

@Controller("admin/billing/subscriptions")
export class AdminBillingSubscriptionsController {
  constructor(private readonly subscriptions: AdminBillingSubscriptionsService) {}

  @Get()
  @RequirePermission("billing.read")
  @RateLimit(60)
  list(@Query() query: QueryDto) {
    return this.subscriptions.list(query);
  }

  @Get(":id")
  @RequirePermission("billing.read")
  @RateLimit(60)
  detail(@Param() params: IdDto) {
    return this.subscriptions.detail(params.id);
  }

  @Post(":id/extend")
  @RequirePermission("users.upgrade")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "subscription.admin_extend", targetType: "subscription", targetParam: "id" })
  extend(
    @Param() params: IdDto,
    @Body() body: ExtendDto,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.subscriptions.extend(params.id, actor, body, audit);
  }

  @Post(":id/end")
  @RequirePermission("users.upgrade")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "subscription.admin_end", targetType: "subscription", targetParam: "id" })
  end(
    @Param() params: IdDto,
    @Body() body: ReasonDto,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    audit.after = { reason: body.reason };
    return this.subscriptions.end(params.id, actor, body.reason);
  }

  @Post(":id/cancel-at-period-end")
  @RequirePermission("users.upgrade")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "subscription.cancel_at_period_end",
    targetType: "subscription",
    targetParam: "id",
  })
  cancelAtPeriodEnd(
    @Param() params: IdDto,
    @Body() body: ReasonDto,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.id;
    audit.after = { reason: body.reason };
    return this.subscriptions.cancelAtPeriodEnd(params.id);
  }
}
