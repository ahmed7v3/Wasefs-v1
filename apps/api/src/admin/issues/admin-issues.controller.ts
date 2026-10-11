import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import {
  issueListQuerySchema,
  issueParamSchema,
  updateIssueSchema,
} from "@wasfa/shared/schemas/admin";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminIssuesService } from "./admin-issues.service.js";

class IssueListQueryDto extends createZodDto(issueListQuerySchema) {}
class IssueParamDto extends createZodDto(issueParamSchema) {}
class UpdateIssueDto extends createZodDto(updateIssueSchema) {}

@Controller("admin/issues")
export class AdminIssuesController {
  constructor(private readonly issues: AdminIssuesService) {}

  @Get()
  @RequirePermission("issues.read")
  @RateLimit(120)
  list(@Query() query: IssueListQueryDto) {
    return this.issues.list(query);
  }

  @Get(":fingerprint")
  @RequirePermission("issues.read")
  @RateLimit(120)
  detail(@Param() params: IssueParamDto) {
    return this.issues.detail(params.fingerprint);
  }

  @Patch(":fingerprint")
  @RequirePermission("issues.write")
  @RateLimit(30)
  @Audited({
    action: "issue.status",
    targetType: "issue",
    targetParam: "fingerprint",
    fields: ["status"],
  })
  update(
    @Param() params: IssueParamDto,
    @Body() body: UpdateIssueDto,
    @AuditCtx() audit: AuditScope,
  ) {
    return this.issues.setStatus(params.fingerprint, body.status, audit);
  }
}
