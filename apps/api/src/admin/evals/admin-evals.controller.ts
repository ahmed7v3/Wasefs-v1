import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import {
  approveCorrectionSchema,
  evalCompareQuerySchema,
  evalIdParamSchema,
  evalItemParamSchema,
  evalRunListQuerySchema,
  rejectCorrectionSchema,
  startEvalRunSchema,
} from "@wasfa/shared/schemas/admin-evals";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminEvalsService, EVAL_AUDIT_FIELDS } from "./admin-evals.service.js";

import type { FastifyRequest } from "fastify";

class IdDto extends createZodDto(evalIdParamSchema) {}
class ItemDto extends createZodDto(evalItemParamSchema) {}
class RunListDto extends createZodDto(evalRunListQuerySchema) {}
class StartRunDto extends createZodDto(startEvalRunSchema) {}
class CompareDto extends createZodDto(evalCompareQuerySchema) {}
class ApproveDto extends createZodDto(approveCorrectionSchema) {}
class RejectDto extends createZodDto(rejectCorrectionSchema) {}

/** `/admin/ai/evals`: accuracy evaluation of prescription reading (Task 2.10). Everything needs `evals.run`. */
@Controller("admin/ai/evals")
export class AdminEvalsController {
  constructor(private readonly evals: AdminEvalsService) {}

  @Get("sets")
  @RequirePermission("evals.run")
  @RateLimit(120)
  sets() {
    return this.evals.sets();
  }

  /** Multipart: `key`, `name`, optional `description`, one `sheet` (XLSX) and the `images`. */
  @Post("import")
  @HttpCode(202)
  @RequirePermission("evals.run")
  @RequireFreshAuth(10)
  @RateLimit(6)
  @Audited({ action: "eval.import", targetType: "eval_import", fields: EVAL_AUDIT_FIELDS })
  startImport(
    @Req() request: FastifyRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.evals.startImport(request, actor.id, audit);
  }

  @Get("imports/:id")
  @RequirePermission("evals.run")
  @RateLimit(600)
  importReport(@Param() params: IdDto) {
    return this.evals.importReport(params.id);
  }

  @Get("runs")
  @RequirePermission("evals.run")
  @RateLimit(120)
  runs(@Query() query: RunListDto) {
    return this.evals.runs(query);
  }

  @Post("runs")
  @RequirePermission("evals.run")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({ action: "eval.run.create", targetType: "eval_run", fields: EVAL_AUDIT_FIELDS })
  startRuns(
    @Body() body: StartRunDto,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.evals.startRuns(body, actor.id, audit);
  }

  // `compare` and `review-queue` are declared before the `:id` routes so they are never read as ids.
  @Get("runs/compare")
  @RequirePermission("evals.run")
  @RateLimit(120)
  compare(@Query() query: CompareDto) {
    return this.evals.compare(query.a, query.b);
  }

  @Get("runs/:id")
  @RequirePermission("evals.run")
  @RateLimit(600)
  run(@Param() params: IdDto) {
    return this.evals.run(params.id);
  }

  @Get("runs/:id/items/:itemId")
  @RequirePermission("evals.run")
  @RateLimit(600)
  item(@Param() params: ItemDto) {
    return this.evals.item(params.id, params.itemId);
  }

  @Post("runs/:id/cancel")
  @HttpCode(200)
  @RequirePermission("evals.run")
  @RateLimit(30)
  @Audited({ action: "eval.run.cancel", targetType: "eval_run", fields: EVAL_AUDIT_FIELDS })
  cancel(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.evals.cancel(params.id, audit);
  }

  @Get("review-queue")
  @RequirePermission("evals.run")
  @RateLimit(120)
  reviewQueue() {
    return this.evals.reviewQueue();
  }

  @Post("review-queue/approve")
  @HttpCode(200)
  @RequirePermission("evals.run")
  @RateLimit(60)
  @Audited({
    action: "eval.correction.approve",
    targetType: "eval_item",
    fields: EVAL_AUDIT_FIELDS,
  })
  approve(
    @Body() body: ApproveDto,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.evals.approve(body, actor.id, audit);
  }

  @Post("review-queue/reject")
  @HttpCode(204)
  @RequirePermission("evals.run")
  @RateLimit(60)
  @Audited({
    action: "eval.correction.reject",
    targetType: "rx_correction",
    fields: EVAL_AUDIT_FIELDS,
  })
  async reject(@Body() body: RejectDto, @AuditCtx() audit: AuditScope): Promise<void> {
    await this.evals.reject(body.correctionId, audit);
  }
}
