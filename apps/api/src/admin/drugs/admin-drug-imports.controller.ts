import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { adminDrugParamSchema, dryRunSchema } from "@wasfa/shared/schemas/admin-drugs";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminDrugImportsService, DRUG_IMPORT_AUDIT_FIELDS } from "./admin-drug-imports.service.js";

import type { FastifyRequest } from "fastify";

class ParamDto extends createZodDto(adminDrugParamSchema) {}
class DryRunDto extends createZodDto(dryRunSchema) {}

/** The import wizard: `/admin/drugs/imports`. The static path wins over `/admin/drugs/:id`. */
@Controller("admin/drugs/imports")
export class AdminDrugImportsController {
  constructor(private readonly imports: AdminDrugImportsService) {}

  @Get()
  @RequirePermission("drugs.read")
  @RateLimit(120)
  list() {
    return this.imports.list();
  }

  /** Multipart: `source`, optional `mapping` (JSON), then the `file` (XLSX or JSON, at most 20 MB). */
  @Post()
  @RequirePermission("drugs.write")
  @RateLimit(10)
  @Audited({
    action: "drug_import.create",
    targetType: "drug_import",
    fields: DRUG_IMPORT_AUDIT_FIELDS,
  })
  create(
    @Req() request: FastifyRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.imports.create(request, actor.id, audit);
  }

  @Get(":id")
  @RequirePermission("drugs.read")
  @RateLimit(600)
  get(@Param() params: ParamDto) {
    return this.imports.get(params.id);
  }

  @Post(":id/dry-run")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RateLimit(30)
  dryRun(
    @Param() params: ParamDto,
    @Body() body: DryRunDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.imports.dryRun(params.id, body, actor.id);
  }

  @Post(":id/commit")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "drug_import.commit",
    targetType: "drug_import",
    fields: DRUG_IMPORT_AUDIT_FIELDS,
  })
  commit(
    @Param() params: ParamDto,
    @CurrentUser() actor: AuthenticatedUser,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.imports.commit(params.id, actor.id, audit);
  }

  @Post(":id/rollback")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RequireFreshAuth(10)
  @RateLimit(10)
  @Audited({
    action: "drug_import.rollback",
    targetType: "drug_import",
    fields: DRUG_IMPORT_AUDIT_FIELDS,
  })
  rollback(@Param() params: ParamDto, @AuditCtx() audit: AuditScope) {
    return this.imports.rollback(params.id, audit);
  }
}
