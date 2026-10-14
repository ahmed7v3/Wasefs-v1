import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  adminAiParamSchema,
  createProviderSchema,
  discoverQuerySchema,
  updateProviderSchema,
} from "@wasfa/shared/schemas/admin-ai";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import {
  AdminAiProvidersService,
  PROVIDER_AUDIT_FIELDS,
  PROVIDER_TEST_AUDIT_FIELDS,
} from "./admin-ai-providers.service.js";

class ParamDto extends createZodDto(adminAiParamSchema) {}
class CreateProviderDto extends createZodDto(createProviderSchema) {}
class UpdateProviderDto extends createZodDto(updateProviderSchema) {}
class DiscoverQueryDto extends createZodDto(discoverQuerySchema) {}

@Controller("admin/ai/providers")
export class AdminAiProvidersController {
  constructor(private readonly providers: AdminAiProvidersService) {}

  @Get()
  @RequirePermission("ai.read")
  @RateLimit(120)
  list() {
    return this.providers.list();
  }

  @Post()
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "ai.provider.create",
    targetType: "ai_provider",
    fields: PROVIDER_AUDIT_FIELDS,
  })
  create(@Body() body: CreateProviderDto, @AuditCtx() audit: AuditScope) {
    return this.providers.create(body, audit);
  }

  @Patch(":id")
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "ai.provider.update",
    targetType: "ai_provider",
    fields: PROVIDER_AUDIT_FIELDS,
  })
  update(
    @Param() params: ParamDto,
    @Body() body: UpdateProviderDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.providers.update(params.id, body, audit);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "ai.provider.delete",
    targetType: "ai_provider",
    fields: PROVIDER_AUDIT_FIELDS,
  })
  async remove(@Param() params: ParamDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.providers.remove(params.id, audit);
  }

  // No fresh login: testing is how an admin checks a key before enabling the provider.
  @Post(":id/test")
  @HttpCode(200)
  @RequirePermission("ai.write")
  @RateLimit(10)
  @Audited({
    action: "ai.provider.test",
    targetType: "ai_provider",
    fields: PROVIDER_TEST_AUDIT_FIELDS,
  })
  test(@Param() params: ParamDto, @AuditCtx() audit: AuditScope) {
    return this.providers.test(params.id, audit);
  }

  @Get(":id/discover")
  @RequirePermission("ai.read")
  @RateLimit(20)
  discover(@Param() params: ParamDto, @Query() query: DiscoverQueryDto) {
    return this.providers.discover(params.id, query.refresh);
  }
}
