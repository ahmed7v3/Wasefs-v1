import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import {
  adminUserListQuerySchema,
  reasonSchema,
  userRoleParamsSchema,
} from "@wasfa/shared/schemas/admin";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminUsersService } from "./admin-users.service.js";

import type { FastifyRequest } from "fastify";

class UserListQueryDto extends createZodDto(adminUserListQuerySchema) {}
class UserIdParamDto extends createZodDto(idParamSchema) {}
class ReasonDto extends createZodDto(reasonSchema) {}
class UserRoleParamsDto extends createZodDto(userRoleParamsSchema) {}

const STATUS_FIELDS = ["status", "reason"] as const;

@Controller("admin/users")
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @RequirePermission("users.read")
  @RateLimit(120)
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  @Get(":id")
  @RequirePermission("users.read")
  @RateLimit(120)
  detail(@Param() params: UserIdParamDto) {
    return this.users.detail(params.id);
  }

  @Post(":id/suspend")
  @HttpCode(200)
  @RequirePermission("users.suspend")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "user.suspend", targetType: "user", fields: STATUS_FIELDS })
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UserIdParamDto,
    @Body() body: ReasonDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.users.suspend(actor, params.id, body.reason, audit);
  }

  @Post(":id/unsuspend")
  @HttpCode(200)
  @RequirePermission("users.suspend")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "user.unsuspend", targetType: "user", fields: STATUS_FIELDS })
  unsuspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: UserIdParamDto,
    @Body() body: ReasonDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.users.unsuspend(actor, params.id, body.reason, audit);
  }

  // Role changes audit themselves (not through `@Audited`): an idempotent no-op writes no row.
  @Put(":id/roles/:roleKey")
  @RequirePermission("users.roles.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  grantRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: UserRoleParamsDto,
    @Body() body: ReasonDto,
  ) {
    return this.users.grantRole(actor, request, params.id, params.roleKey, body.reason);
  }

  @Delete(":id/roles/:roleKey")
  @RequirePermission("users.roles.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  revokeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: FastifyRequest,
    @Param() params: UserRoleParamsDto,
    @Body() body: ReasonDto,
  ) {
    return this.users.revokeRole(actor, request, params.id, params.roleKey, body.reason);
  }
}
