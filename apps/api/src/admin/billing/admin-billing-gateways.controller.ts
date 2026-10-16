import { Body, Controller, Get, Param, Post, Put } from "@nestjs/common";
import {
  gatewayCredentialsSchema,
  gatewayCreateSchema,
  gatewayEnabledSchema,
  gatewayMethodParamSchema,
  gatewayModeSchema,
  gatewayParamSchema,
  gatewayTestParamSchema,
  gatewayTestStartSchema,
} from "@wasfa/shared/schemas/admin-billing-gateways";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import {
  AdminBillingGatewaysService,
  GATEWAY_AUDIT_FIELDS,
  GATEWAY_TEST_AUDIT_FIELDS,
} from "./admin-billing-gateways.service.js";

class KeyDto extends createZodDto(gatewayParamSchema) {}
class TestDto extends createZodDto(gatewayTestParamSchema) {}
class CreateDto extends createZodDto(gatewayCreateSchema) {}
class CredentialsDto extends createZodDto(gatewayCredentialsSchema) {}
class ModeDto extends createZodDto(gatewayModeSchema) {}
class EnabledDto extends createZodDto(gatewayEnabledSchema) {}
class TestStartDto extends createZodDto(gatewayTestStartSchema) {}
class MethodParamDto extends createZodDto(gatewayMethodParamSchema) {}

@Controller("admin/billing/gateways")
export class AdminBillingGatewaysController {
  constructor(private readonly gateways: AdminBillingGatewaysService) {}

  @Get()
  @RequirePermission("billing.read")
  @RateLimit(60)
  list() {
    return this.gateways.list();
  }

  @Post()
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "billing.gateway.create",
    targetType: "payment_gateway",
    fields: GATEWAY_AUDIT_FIELDS,
  })
  create(
    @Body() body: CreateDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.gateways.create(body, user.id, audit);
  }

  @Put(":key/credentials")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "billing.gateway.credentials",
    targetType: "payment_gateway",
    fields: GATEWAY_AUDIT_FIELDS,
  })
  credentials(
    @Param() params: KeyDto,
    @Body() body: CredentialsDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.gateways.updateCredentials(params.key, body, user.id, audit);
  }

  @Put(":key/mode")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "billing.gateway.mode",
    targetType: "payment_gateway",
    fields: GATEWAY_AUDIT_FIELDS,
  })
  mode(
    @Param() params: KeyDto,
    @Body() body: ModeDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.gateways.changeMode(params.key, body, user.id, audit);
  }

  @Post(":key/test-connection")
  @RequirePermission("billing.write")
  @RateLimit(10)
  @Audited({
    action: "billing.gateway.test_connection",
    targetType: "payment_gateway",
    fields: GATEWAY_TEST_AUDIT_FIELDS,
  })
  testConnection(@Param() params: KeyDto, @AuditCtx() audit: AuditScope) {
    return this.gateways.testConnection(params.key, audit);
  }

  @Post(":key/test-payments")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(5)
  @Audited({
    action: "billing.gateway.test_payment",
    targetType: "payment_gateway",
    fields: ["id", "status"],
  })
  startTest(
    @Param() params: KeyDto,
    @Body() body: TestStartDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.gateways.startTest(params.key, body, user.id).then((result) => {
      audit.targetId = result.id;
      audit.after = { id: result.id, status: result.status };
      return result;
    });
  }

  @Get(":key/test-payments/:id")
  @RequirePermission("billing.read")
  @RateLimit(60)
  getTest(@Param() params: TestDto) {
    return this.gateways.getTest(params.key, params.id);
  }

  @Post(":key/test-payments/:id/check")
  @RequirePermission("billing.write")
  @RateLimit(20)
  @Audited({
    action: "billing.gateway.check_test",
    targetType: "payment_gateway_test",
    fields: ["status", "checklist"],
  })
  checkTest(@Param() params: TestDto, @AuditCtx() audit: AuditScope) {
    return this.gateways.checkTest(params.key, params.id).then((result) => {
      audit.targetId = result.id;
      audit.after = { status: result.status, checklist: result.checklist };
      return result;
    });
  }

  @Put(":key/enabled")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "billing.gateway.enabled",
    targetType: "payment_gateway",
    fields: GATEWAY_AUDIT_FIELDS,
  })
  enabled(@Param() params: KeyDto, @Body() body: EnabledDto, @AuditCtx() audit: AuditScope) {
    return this.gateways.setEnabled(params.key, body.enabled, body.reason, audit);
  }

  @Put(":key/methods/:methodKey")
  @RequirePermission("billing.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "billing.gateway.method",
    targetType: "payment_method",
    fields: ["key", "enabled", "reason"],
  })
  method(@Param() params: MethodParamDto, @Body() body: EnabledDto, @AuditCtx() audit: AuditScope) {
    return this.gateways.setMethod(params.key, params.methodKey, body.enabled, body.reason, audit);
  }
}
