import { Controller, Get, Param, Query } from "@nestjs/common";
import { adminOrgListQuerySchema } from "@wasfa/shared/schemas/admin";
import { idParamSchema } from "@wasfa/shared/schemas/user";

import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminOrgsService } from "./admin-orgs.service.js";

class OrgListQueryDto extends createZodDto(adminOrgListQuerySchema) {}
class OrgIdParamDto extends createZodDto(idParamSchema) {}

@Controller("admin/orgs")
export class AdminOrgsController {
  constructor(private readonly orgs: AdminOrgsService) {}

  @Get()
  @RequirePermission("orgs.read")
  @RateLimit(120)
  list(@Query() query: OrgListQueryDto) {
    return this.orgs.list(query);
  }

  @Get(":id")
  @RequirePermission("orgs.read")
  @RateLimit(120)
  detail(@Param() params: OrgIdParamDto) {
    return this.orgs.detail(params.id);
  }
}
