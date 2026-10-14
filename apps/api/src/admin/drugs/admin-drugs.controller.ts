import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import {
  addAliasSchema,
  adminDrugParamSchema,
  drugSearchQuerySchema,
  mergeDrugsSchema,
  updateDrugSchema,
} from "@wasfa/shared/schemas/admin-drugs";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { RequireFreshAuth } from "../../common/fresh-auth.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import {
  AdminDrugsService,
  DRUG_ALIAS_AUDIT_FIELDS,
  DRUG_AUDIT_FIELDS,
  DRUG_MERGE_AUDIT_FIELDS,
} from "./admin-drugs.service.js";

class ParamDto extends createZodDto(adminDrugParamSchema) {}
class SearchQueryDto extends createZodDto(drugSearchQuerySchema) {}
class UpdateDrugDto extends createZodDto(updateDrugSchema) {}
class AddAliasDto extends createZodDto(addAliasSchema) {}
class MergeDto extends createZodDto(mergeDrugsSchema) {}

// `merge` is declared before the `:id` routes so it is never read as an id.
@Controller("admin/drugs")
export class AdminDrugsController {
  constructor(private readonly drugs: AdminDrugsService) {}

  @Get()
  @RequirePermission("drugs.read")
  @RateLimit(120)
  search(@Query() query: SearchQueryDto) {
    return this.drugs.search(query);
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

  @Post(":id/aliases")
  @RequirePermission("drugs.write")
  @RateLimit(60)
  @Audited({ action: "drug.alias_add", targetType: "drug", fields: DRUG_ALIAS_AUDIT_FIELDS })
  addAlias(@Param() params: ParamDto, @Body() body: AddAliasDto, @AuditCtx() audit: AuditScope) {
    return this.drugs.addAlias(params.id, body, audit);
  }
}
