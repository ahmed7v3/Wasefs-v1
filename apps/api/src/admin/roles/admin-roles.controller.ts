import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { createRoleSchema, roleParamSchema, updateRoleSchema } from "@wasfa/shared/schemas/admin";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminRolesService, ROLE_AUDIT_FIELDS } from "./admin-roles.service.js";

class CreateRoleDto extends createZodDto(createRoleSchema) {}
class UpdateRoleDto extends createZodDto(updateRoleSchema) {}
class RoleParamDto extends createZodDto(roleParamSchema) {}

@Controller("admin/roles")
export class AdminRolesController {
  constructor(private readonly roles: AdminRolesService) {}

  @Get()
  @RequirePermission("roles.read")
  @RateLimit(120)
  list() {
    return this.roles.list();
  }

  // The role editor is super_admin only (SECURITY.md section 5.4): `roles.write` is necessary, not sufficient.
  @Post()
  @RequirePermission("roles.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "role.create", targetType: "role", fields: ROLE_AUDIT_FIELDS })
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: CreateRoleDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.roles.create(actor, body, audit);
  }

  @Patch(":key")
  @RequirePermission("roles.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "role.update",
    targetType: "role",
    targetParam: "key",
    fields: ROLE_AUDIT_FIELDS,
  })
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: RoleParamDto,
    @Body() body: UpdateRoleDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.roles.update(actor, params.key, body, audit);
  }

  @Delete(":key")
  @HttpCode(204)
  @RequirePermission("roles.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "role.delete",
    targetType: "role",
    targetParam: "key",
    fields: ROLE_AUDIT_FIELDS,
  })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param() params: RoleParamDto,
    @AuditCtx() audit: AuditScope,
  ): Promise<void> {
    await this.roles.remove(actor, params.key, audit);
  }
}

@Controller("admin/permissions")
export class AdminPermissionsController {
  constructor(private readonly roles: AdminRolesService) {}

  @Get()
  @RequirePermission("roles.read")
  @RateLimit(120)
  catalog() {
    return this.roles.catalog();
  }
}
