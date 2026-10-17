import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import {
  accountChangeSchema,
  paymentMethodKeyParamSchema,
} from "@wasfa/shared/schemas/admin-payment-methods";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminBillingMethodsService } from "./admin-billing-methods.service.js";

import type { FastifyRequest } from "fastify";

class KeyDto extends createZodDto(paymentMethodKeyParamSchema) {}
class ChangeDto extends createZodDto(accountChangeSchema) {}

@Controller("admin/billing/methods/:key/account-change")
@RequirePermission("billing.write")
export class AdminBillingMethodsController {
  constructor(private readonly methods: AdminBillingMethodsService) {}

  @Get()
  @RateLimit(60)
  pending(@Param() params: KeyDto) {
    return this.methods.pending(params.key);
  }

  @Post()
  @RequireFreshAuth(10)
  @RateLimit(5)
  @Audited({
    action: "payment_method.account_change_requested",
    targetType: "payment_method",
    targetParam: "key",
    fields: ["reason", "effectiveAt"],
  })
  async request(
    @Param() params: KeyDto,
    @Body() body: ChangeDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.key;
    audit.after = { reason: body.reason };
    return this.methods.request(params.key, user.id, request.headers, {
      ...body,
      accountHolder: body.accountHolder ?? null,
    });
  }

  @Post("cancel")
  @RequireFreshAuth(10)
  @RateLimit(5)
  @Audited({
    action: "payment_method.account_change_canceled",
    targetType: "payment_method",
    targetParam: "key",
    afterFromResponse: true,
  })
  cancel(
    @Param() params: KeyDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    audit.targetId = params.key;
    return this.methods.cancel(params.key, user.id);
  }
}
