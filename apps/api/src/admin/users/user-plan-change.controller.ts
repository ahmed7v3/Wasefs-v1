import { Body, Controller, HttpCode, Param, Post, Req } from "@nestjs/common";
import {
  adminPlanChangePreviewSchema,
  adminPlanChangeSchema,
  adminUserParamsSchema,
} from "@wasfa/shared/schemas/admin-user-360";

import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminPlanChangeService } from "./user-plan-change.service.js";

import type { FastifyRequest } from "fastify";

class IdParamsDto extends createZodDto(adminUserParamsSchema) {}
class PreviewDto extends createZodDto(adminPlanChangePreviewSchema) {}
class PlanChangeDto extends createZodDto(adminPlanChangeSchema) {}

/**
 * The change-plan dialog for a user (ADMIN-CONSOLE-SPEC §8.3). Fresh sign-in is demanded by the
 * service, not by a decorator: only an offline payment or a large price needs it.
 */
@Controller("admin/users/:id/plan-change")
export class AdminUserPlanChangeController {
  constructor(private readonly changes: AdminPlanChangeService) {}

  @Post("preview")
  @HttpCode(200)
  @RequirePermission("users.upgrade")
  @RateLimit(60)
  preview(@Param() params: IdParamsDto, @Body() body: PreviewDto) {
    return this.changes.preview({ type: "user", id: params.id }, body);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission("users.upgrade")
  @RateLimit(20)
  apply(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: IdParamsDto,
    @Body() body: PlanChangeDto,
    @Req() request: FastifyRequest,
  ) {
    return this.changes.apply(actor, { type: "user", id: params.id }, body, request);
  }
}

/** The same dialog on an organization page: the organization is the owner. */
@Controller("admin/orgs/:id/plan-change")
export class AdminOrgPlanChangeController {
  constructor(private readonly changes: AdminPlanChangeService) {}

  @Post("preview")
  @HttpCode(200)
  @RequirePermission("users.upgrade")
  @RateLimit(60)
  preview(@Param() params: IdParamsDto, @Body() body: PreviewDto) {
    return this.changes.preview({ type: "org", id: params.id }, body);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission("users.upgrade")
  @RateLimit(20)
  apply(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: IdParamsDto,
    @Body() body: PlanChangeDto,
    @Req() request: FastifyRequest,
  ) {
    return this.changes.apply(actor, { type: "org", id: params.id }, body, request);
  }
}
