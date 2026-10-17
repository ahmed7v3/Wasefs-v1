import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  createPromotionSchema,
  discountIdParamSchema,
  promotionListQuerySchema,
  updatePromotionSchema,
} from "@wasfa/shared/schemas/billing";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CatalogInvalidationInterceptor } from "../../catalog/catalog-invalidation.interceptor.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto, parseWithSchema } from "../../common/validation.js";
import { PromotionsService } from "../../promotions/promotions.service.js";

import type { UpdatePromotionInput } from "@wasfa/shared/schemas/billing";


class CreateDto extends createZodDto(createPromotionSchema) {}
class IdDto extends createZodDto(discountIdParamSchema) {}
class ListDto extends createZodDto(promotionListQuerySchema) {}

function promotionPatch(value: unknown): UpdatePromotionInput {
  if (
    typeof value === "object" &&
    value !== null &&
    ["kind", "value", "currency"].some((field) => Object.hasOwn(value, field))
  ) {
    throw new AppError(ErrorCode.CONFLICT);
  }
  return parseWithSchema(updatePromotionSchema, value);
}

@UseInterceptors(CatalogInvalidationInterceptor)
@UseInterceptors(CatalogInvalidationInterceptor)
@Controller("admin/billing/promotions")
export class AdminBillingPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @RequirePermission("billing.read")
  @RateLimit(120)
  list(@Query() query: ListDto) {
    return this.promotions.list(query);
  }

  @Get(":id")
  @RequirePermission("billing.read")
  @RateLimit(120)
  get(@Param() params: IdDto) {
    return this.promotions.get(params.id);
  }

  @Post()
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "promotion.created", targetType: "promotion" })
  create(
    @Body() body: CreateDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.promotions.create(body, user, audit);
  }

  @Patch(":id")
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "promotion.updated", targetType: "promotion", targetParam: "id" })
  update(@Param() params: IdDto, @Body() body: unknown, @AuditCtx() audit: AuditScope) {
    audit.targetId = params.id;
    return this.promotions.update(params.id, promotionPatch(body), audit);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "promotion.deleted", targetType: "promotion", targetParam: "id" })
  remove(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.promotions.remove(params.id, audit);
  }

  @Post(":id/publish")
  @RequirePermission("promotions.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "promotion.published", targetType: "promotion", targetParam: "id" })
  publish(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.promotions.transition(params.id, "publish", audit);
  }

  @Post(":id/pause")
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "promotion.paused", targetType: "promotion", targetParam: "id" })
  pause(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.promotions.transition(params.id, "pause", audit);
  }

  @Post(":id/resume")
  @RequirePermission("promotions.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "promotion.resumed", targetType: "promotion", targetParam: "id" })
  resume(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.promotions.transition(params.id, "resume", audit);
  }

  @Post(":id/end")
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "promotion.ended", targetType: "promotion", targetParam: "id" })
  end(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.promotions.transition(params.id, "end", audit);
  }

  @Post(":id/duplicate")
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "promotion.duplicated", targetType: "promotion" })
  duplicate(
    @Param() params: IdDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.promotions.duplicate(params.id, user, audit);
  }
}
