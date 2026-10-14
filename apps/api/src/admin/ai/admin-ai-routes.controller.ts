import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { adminAiParamSchema, putRouteSchema } from "@wasfa/shared/schemas/admin-ai";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAiRoutesService, ROUTE_AUDIT_FIELDS } from "./admin-ai-routes.service.js";

class ParamDto extends createZodDto(adminAiParamSchema) {}
class PutRouteDto extends createZodDto(putRouteSchema) {}

@Controller("admin/ai/routes")
export class AdminAiRoutesController {
  constructor(private readonly routes: AdminAiRoutesService) {}

  @Get()
  @RequirePermission("ai.read")
  @RateLimit(120)
  list() {
    return this.routes.list();
  }

  @Put()
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "ai.route.update", targetType: "ai_route", fields: ROUTE_AUDIT_FIELDS })
  put(@Body() body: PutRouteDto, @AuditCtx() audit: AuditScope) {
    return this.routes.put(body, audit);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "ai.route.delete", targetType: "ai_route", fields: ROUTE_AUDIT_FIELDS })
  async remove(@Param() params: ParamDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.routes.remove(params.id, audit);
  }
}
