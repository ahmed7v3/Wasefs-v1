import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  addAliasSchema,
  adminDrugParamSchema,
  createDrugSchema,
  drugSearchQuerySchema,
  learnedDecisionSchema,
  learnedQuerySchema,
  mapUnmatchedSchema,
  mergeDrugsSchema,
  setDrugStatusSchema,
  unmatchedParamSchema,
  unmatchedQuerySchema,
  updateDrugSchema,
} from "@wasfa/shared/schemas/admin-drugs";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { CurrentUser, type AuthenticatedUser } from "../../common/current-user.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import {
  AdminDrugsService,
  DRUG_ALIAS_AUDIT_FIELDS,
  DRUG_AUDIT_FIELDS,
  DRUG_MERGE_AUDIT_FIELDS,
  DRUG_QUEUE_AUDIT_FIELDS,
} from "./admin-drugs.service.js";

class ParamDto extends createZodDto(adminDrugParamSchema) {}
class SearchQueryDto extends createZodDto(drugSearchQuerySchema) {}
class CreateDrugDto extends createZodDto(createDrugSchema) {}
class UpdateDrugDto extends createZodDto(updateDrugSchema) {}
class SetStatusDto extends createZodDto(setDrugStatusSchema) {}
class AddAliasDto extends createZodDto(addAliasSchema) {}
class MergeDto extends createZodDto(mergeDrugsSchema) {}
class UnmatchedParamDto extends createZodDto(unmatchedParamSchema) {}
class UnmatchedQueryDto extends createZodDto(unmatchedQuerySchema) {}
class MapUnmatchedDto extends createZodDto(mapUnmatchedSchema) {}
class LearnedQueryDto extends createZodDto(learnedQuerySchema) {}
class LearnedDecisionDto extends createZodDto(learnedDecisionSchema) {}

// The fixed paths (`merge`, `categories`, `unmatched`, `learned`) are declared before the `:id` routes
// so they are never read as an id.
@Controller("admin/drugs")
export class AdminDrugsController {
  constructor(private readonly drugs: AdminDrugsService) {}

  @Get()
  @RequirePermission("drugs.read")
  @RateLimit(120)
  search(@Query() query: SearchQueryDto) {
    return this.drugs.search(query);
  }

  @Post()
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({ action: "drug.create", targetType: "drug", fields: DRUG_AUDIT_FIELDS })
  create(@Body() body: CreateDrugDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.create(body, audit);
  }

  @Get("categories")
  @RequirePermission("drugs.read")
  @RateLimit(120)
  categories() {
    return this.drugs.categories();
  }

  @Post("merge")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "drug.merge", targetType: "drug", fields: DRUG_MERGE_AUDIT_FIELDS })
  merge(@Body() body: MergeDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.merge(body, audit);
  }

  // --- Review queues ---

  @Get("unmatched")
  @RequirePermission("drugs.read")
  @RateLimit(120)
  unmatched(@Query() query: UnmatchedQueryDto) {
    return this.drugs.unmatched(query);
  }

  @Post("unmatched/:normalized/map")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({
    action: "drug.unmatched_map",
    targetType: "drug",
    fields: DRUG_QUEUE_AUDIT_FIELDS,
  })
  mapUnmatched(
    @CurrentUser() admin: AuthenticatedUser,
    @Param() params: UnmatchedParamDto,
    @Body() body: MapUnmatchedDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.drugs.mapUnmatched(params.normalized, body, admin.id, audit);
  }

  @Post("unmatched/:normalized/ignore")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({
    action: "drug.unmatched_ignore",
    targetType: "drug_unmatched",
    targetParam: "normalized",
    fields: DRUG_QUEUE_AUDIT_FIELDS,
  })
  ignoreUnmatched(@Param() params: UnmatchedParamDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.ignoreUnmatched(params.normalized, audit);
  }

  @Get("learned")
  @RequirePermission("drugs.read")
  @RateLimit(120)
  learned(@Query() query: LearnedQueryDto) {
    return this.drugs.learned(query);
  }

  @Post("learned/approve")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({
    action: "drug.learned_approve",
    targetType: "drug",
    fields: DRUG_QUEUE_AUDIT_FIELDS,
  })
  approveLearned(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: LearnedDecisionDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.drugs.approveLearned(body, admin.id, audit);
  }

  @Post("learned/reject")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({
    action: "drug.learned_reject",
    targetType: "drug",
    fields: DRUG_QUEUE_AUDIT_FIELDS,
  })
  rejectLearned(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() body: LearnedDecisionDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.drugs.rejectLearned(body, admin.id, audit);
  }

  // --- One entry ---

  @Get(":id")
  @RequirePermission("drugs.read")
  @RateLimit(120)
  get(@Param() params: ParamDto) {
    return this.drugs.get(params.id);
  }

  @Patch(":id")
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({ action: "drug.update", targetType: "drug", fields: DRUG_AUDIT_FIELDS })
  update(@Param() params: ParamDto, @Body() body: UpdateDrugDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.update(params.id, body, audit);
  }

  @Post(":id/status")
  @HttpCode(200)
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({ action: "drug.status", targetType: "drug", fields: DRUG_AUDIT_FIELDS })
  setStatus(@Param() params: ParamDto, @Body() body: SetStatusDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.setStatus(params.id, body.status, audit);
  }

  @Delete(":id")
  @RequirePermission("drugs.write")
  @RequireFreshAuth(10)
  @RateLimit(30)
  @Audited({ action: "drug.delete", targetType: "drug", fields: DRUG_AUDIT_FIELDS })
  remove(@Param() params: ParamDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.remove(params.id, audit);
  }

  @Post(":id/aliases")
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({ action: "drug.alias_add", targetType: "drug", fields: DRUG_ALIAS_AUDIT_FIELDS })
  addAlias(@Param() params: ParamDto, @Body() body: AddAliasDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.addAlias(params.id, body, audit);
  }
}
