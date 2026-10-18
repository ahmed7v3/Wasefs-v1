import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  createExperimentSchema,
  experimentIdParamSchema,
  growthFunnelQuerySchema,
  updateExperimentSchema,
} from "@wasfa/shared/schemas/growth";

import { AuditCtx, Audited, type AuditScope } from "../../audit/audited.decorator.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminExperimentsService } from "./admin-experiments.service.js";

class CreateDto extends createZodDto(createExperimentSchema) {}
class UpdateDto extends createZodDto(updateExperimentSchema) {}
class IdDto extends createZodDto(experimentIdParamSchema) {}
class FunnelDto extends createZodDto(growthFunnelQuerySchema) {}

/** Experiments with guardrail metrics and the conversion funnel (Task 3.14; ADMIN-CONSOLE-SPEC §6.5). */
@Controller("admin/growth")
export class AdminExperimentsController {
  constructor(private readonly experiments: AdminExperimentsService) {}

  @Get("experiments")
  @RequirePermission("referrals.read")
  @RateLimit(120)
  list() {
    return this.experiments.list();
  }

  @Post("experiments")
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "experiment.created", targetType: "experiment" })
  create(@Body() body: CreateDto, @AuditCtx() audit: AuditScope) {
    return this.experiments.create(body, audit);
  }

  @Patch("experiments/:id")
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "experiment.updated", targetType: "experiment" })
  update(@Param() params: IdDto, @Body() body: UpdateDto, @AuditCtx() audit: AuditScope) {
    return this.experiments.update(params.id, body, audit);
  }

  @Post("experiments/:id/start")
  @HttpCode(200)
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "experiment.started", targetType: "experiment" })
  start(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.experiments.transition(params.id, "start", audit);
  }

  @Post("experiments/:id/stop")
  @HttpCode(200)
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "experiment.stopped", targetType: "experiment" })
  stop(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.experiments.transition(params.id, "stop", audit);
  }

  @Post("experiments/:id/complete")
  @HttpCode(200)
  @RequirePermission("promotions.write")
  @RateLimit(30)
  @Audited({ action: "experiment.completed", targetType: "experiment" })
  complete(@Param() params: IdDto, @AuditCtx() audit: AuditScope) {
    return this.experiments.transition(params.id, "complete", audit);
  }

  @Get("experiments/:id/results")
  @RequirePermission("referrals.read")
  @RateLimit(60)
  results(@Param() params: IdDto) {
    return this.experiments.results(params.id);
  }

  @Get("funnel")
  @RequirePermission("billing.read")
  @RateLimit(60)
  funnel(@Query() query: FunnelDto) {
    return this.experiments.funnel(query);
  }
}
