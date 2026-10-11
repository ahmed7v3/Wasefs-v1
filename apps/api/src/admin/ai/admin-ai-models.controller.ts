import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  adminAiParamSchema,
  applyPriceSyncSchema,
  createModelSchema,
  modelsQuerySchema,
  updateModelSchema,
} from "@wasfa/shared/schemas/admin-ai";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAiModelsService, MODEL_AUDIT_FIELDS } from "./admin-ai-models.service.js";
import { AdminAiPriceSyncService, PRICE_SYNC_AUDIT_FIELDS } from "./admin-ai-price-sync.service.js";

class ParamDto extends createZodDto(adminAiParamSchema) {}
class ModelsQueryDto extends createZodDto(modelsQuerySchema) {}
class CreateModelDto extends createZodDto(createModelSchema) {}
class UpdateModelDto extends createZodDto(updateModelSchema) {}
class ApplyPriceSyncDto extends createZodDto(applyPriceSyncSchema) {}

// The static `price-sync` routes are declared before the `:id` ones so they are never read as an id.
@Controller("admin/ai/models")
export class AdminAiModelsController {
  constructor(
    private readonly models: AdminAiModelsService,
    private readonly priceSync: AdminAiPriceSyncService,
  ) {}

  @Get()
  @RequirePermission("ai.read")
  @RateLimit(120)
  list(@Query() query: ModelsQueryDto) {
    return this.models.list(query.providerId);
  }

  @Post("price-sync/preview")
  @HttpCode(200)
  @RequirePermission("ai.write")
  @RateLimit(5)
  preview(@CurrentUser() actor: AuthenticatedUser) {
    return this.priceSync.preview(actor.id);
  }

  @Post("price-sync/apply")
  @HttpCode(200)
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({
    action: "ai.model.price_sync",
    targetType: "ai_model",
    fields: PRICE_SYNC_AUDIT_FIELDS,
  })
  apply(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: ApplyPriceSyncDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.priceSync.apply(actor.id, body, audit);
  }

  @Post()
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "ai.model.create", targetType: "ai_model", fields: MODEL_AUDIT_FIELDS })
  create(@Body() body: CreateModelDto, @AuditCtx() audit: AuditScope) {
    return this.models.create(body, audit);
  }

  @Patch(":id")
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "ai.model.update", targetType: "ai_model", fields: MODEL_AUDIT_FIELDS })
  update(@Param() params: ParamDto, @Body() body: UpdateModelDto, @AuditCtx() audit: AuditScope) {
    return this.models.update(params.id, body, audit);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("ai.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "ai.model.delete", targetType: "ai_model", fields: MODEL_AUDIT_FIELDS })
  async remove(@Param() params: ParamDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.models.remove(params.id, audit);
  }
}
