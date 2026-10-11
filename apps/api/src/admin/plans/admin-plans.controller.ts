import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  assignPlanSchema,
  createPlanSchema,
  planAssignmentsQuerySchema,
  planParamSchema,
  putEntitlementsSchema,
  updatePlanSchema,
} from "@wasfa/shared/schemas/plans";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import {
  ASSIGNMENT_AUDIT_FIELDS,
  AdminPlansService,
  ENTITLEMENT_AUDIT_FIELDS,
  PLAN_AUDIT_FIELDS,
} from "./admin-plans.service.js";

class CreatePlanDto extends createZodDto(createPlanSchema) {}
class UpdatePlanDto extends createZodDto(updatePlanSchema) {}
class PlanParamDto extends createZodDto(planParamSchema) {}
class PutEntitlementsDto extends createZodDto(putEntitlementsSchema) {}
class AssignPlanDto extends createZodDto(assignPlanSchema) {}
class AssignmentsQueryDto extends createZodDto(planAssignmentsQuerySchema) {}

// The static `assignments` routes are declared before the `:id` ones so they are never read as an id.
@Controller("admin/plans")
export class AdminPlansController {
  constructor(private readonly plans: AdminPlansService) {}

  @Get()
  @RequirePermission("plans.read")
  @RateLimit(120)
  list() {
    return this.plans.list();
  }

  @Get("assignments")
  @RequirePermission("plans.read")
  @RateLimit(120)
  assignments(@Query() query: AssignmentsQueryDto) {
    return this.plans.assignments(query);
  }

  @Post("assignments")
  @RequirePermission("plans.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "plan.assign",
    targetType: "plan_assignment",
    fields: ASSIGNMENT_AUDIT_FIELDS,
  })
  assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: AssignPlanDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.plans.assign(actor, body, audit);
  }

  @Post("assignments/:id/end")
  @HttpCode(204)
  @RequirePermission("plans.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "plan.assignment_end",
    targetType: "plan_assignment",
    fields: ASSIGNMENT_AUDIT_FIELDS,
  })
  async endAssignment(@Param() params: PlanParamDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.plans.endAssignment(params.id, audit);
  }

  @Post()
  @RequirePermission("plans.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "plan.create", targetType: "plan", fields: PLAN_AUDIT_FIELDS })
  create(@Body() body: CreatePlanDto, @AuditCtx() audit: AuditScope) {
    return this.plans.create(body, audit);
  }

  @Patch(":id")
  @RequirePermission("plans.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "plan.update", targetType: "plan", fields: PLAN_AUDIT_FIELDS })
  update(
    @Param() params: PlanParamDto,
    @Body() body: UpdatePlanDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.plans.update(params.id, body, audit);
  }

  @Put(":id/entitlements")
  @RequirePermission("plans.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "plan.entitlements",
    targetType: "plan",
    fields: ENTITLEMENT_AUDIT_FIELDS,
  })
  replaceEntitlements(
    @Param() params: PlanParamDto,
    @Body() body: PutEntitlementsDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.plans.replaceEntitlements(params.id, body, audit);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("plans.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "plan.delete", targetType: "plan", fields: PLAN_AUDIT_FIELDS })
  async remove(@Param() params: PlanParamDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.plans.remove(params.id, audit);
  }
}
