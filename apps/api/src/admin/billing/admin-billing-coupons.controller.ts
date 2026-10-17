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
  Res,
} from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  bulkCouponSchema,
  couponBatchParamSchema,
  createCouponSchema,
  discountIdParamSchema,
  discountListQuerySchema,
  updateCouponSchema,
} from "@wasfa/shared/schemas/billing";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto, parseWithSchema } from "../../common/validation.js";
import { CouponsService } from "../../coupons/coupons.service.js";

import type { UpdateCouponInput } from "@wasfa/shared/schemas/billing";
import type { FastifyReply } from "fastify";
class CreateDto extends createZodDto(createCouponSchema) {}
class BulkDto extends createZodDto(bulkCouponSchema) {}
class IdDto extends createZodDto(discountIdParamSchema) {}
class BatchDto extends createZodDto(couponBatchParamSchema) {}
class ListDto extends createZodDto(discountListQuerySchema) {}

function couponPatch(value: unknown): UpdateCouponInput {
  if (
    typeof value === "object" &&
    value !== null &&
    ["kind", "value", "currency", "code"].some((field) => Object.hasOwn(value, field))
  ) {
    throw new AppError(ErrorCode.CONFLICT);
  }
  return parseWithSchema(updateCouponSchema, value);
}

@Controller("admin/billing/coupons")
export class AdminBillingCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @RequirePermission("billing.read")
  @RateLimit(120)
  list(@Query() query: ListDto) {
    return this.coupons.list(query);
  }

  @Get("batches/:batch/export")
  @RequirePermission("billing.read")
  @RateLimit(30)
  @Audited({ action: "coupon.batch_exported", targetType: "coupon_batch" })
  async export(
    @Param() params: BatchDto,
    @Res({ passthrough: true }) reply: FastifyReply,
    @AuditCtx() audit: AuditScope,
  ) {
    const csv = await this.coupons.exportBatch(params.batch, audit);
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="coupons-${params.batch}.csv"`);
    return csv;
  }

  @Post("batches/:batch/publish")
  @RequirePermission("coupons.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "coupon.batch_publish", targetType: "coupon_batch" })
  publishBatch(@Param() params: BatchDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transitionBatch(params.batch, "publish", audit);
  }

  @Post("batches/:batch/pause")
  @RequirePermission("coupons.write")
  @RateLimit(30)
  @Audited({ action: "coupon.batch_pause", targetType: "coupon_batch" })
  pauseBatch(@Param() params: BatchDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transitionBatch(params.batch, "pause", audit);
  }

  @Post("batches/:batch/resume")
  @RequirePermission("coupons.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "coupon.batch_resume", targetType: "coupon_batch" })
  resumeBatch(@Param() params: BatchDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transitionBatch(params.batch, "resume", audit);
  }

  @Post("batches/:batch/end")
  @RequirePermission("coupons.write")
  @RateLimit(30)
  @Audited({ action: "coupon.batch_end", targetType: "coupon_batch" })
  endBatch(@Param() params: BatchDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transitionBatch(params.batch, "end", audit);
  }

  @Post("bulk")
  @RequirePermission("coupons.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "coupon.bulk_created", targetType: "coupon_batch" })
  bulk(
    @Body() body: BulkDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.coupons.bulk(body, user, audit);
  }

  @Get(":id")
  @RequirePermission("billing.read")
  @RateLimit(120)
  get(@Param() params: IdDto) {
    return this.coupons.get(params.id);
  }

  @Post()
  @RequirePermission("coupons.write")
  @RateLimit(30)
  @Audited({ action: "coupon.created", targetType: "coupon" })
  create(
    @Body() body: CreateDto,
    @CurrentUser() user: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.coupons.create(body, user, audit);
  }

  @Patch(":id")
  @RequirePermission("coupons.write")
  @RateLimit(30)
  @Audited({ action: "coupon.updated", targetType: "coupon", targetParam: "id" })
  update(@Param() params: IdDto, @Body() body: unknown, @AuditCtx() audit: AuditScope) {
    audit.targetId = params.id;
    return this.coupons.update(params.id, couponPatch(body), audit);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("coupons.write")
  @RateLimit(30)
  @Audited({ action: "coupon.deleted", targetType: "coupon", targetParam: "id" })
  remove(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.remove(params.id, audit);
  }

  @Post(":id/publish")
  @RequirePermission("coupons.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "coupon.published", targetType: "coupon", targetParam: "id" })
  publish(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transition(params.id, "publish", audit);
  }

  @Post(":id/pause")
  @RequirePermission("coupons.write")
  @RateLimit(30)
  @Audited({ action: "coupon.paused", targetType: "coupon", targetParam: "id" })
  pause(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transition(params.id, "pause", audit);
  }

  @Post(":id/resume")
  @RequirePermission("coupons.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "coupon.resumed", targetType: "coupon", targetParam: "id" })
  resume(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transition(params.id, "resume", audit);
  }

  @Post(":id/end")
  @RequirePermission("coupons.write")
  @RateLimit(30)
  @Audited({ action: "coupon.ended", targetType: "coupon", targetParam: "id" })
  end(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.coupons.transition(params.id, "end", audit);
  }
}
