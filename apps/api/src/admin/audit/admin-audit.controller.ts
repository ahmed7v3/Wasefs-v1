import { Controller, Get, Query } from "@nestjs/common";
import { auditQuerySchema } from "@wasfa/shared/schemas/admin";

import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAuditService } from "./admin-audit.service.js";

class AuditQueryDto extends createZodDto(auditQuerySchema) {}

@Controller("admin/audit")
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @RequirePermission("audit.read")
  @RateLimit(120)
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
