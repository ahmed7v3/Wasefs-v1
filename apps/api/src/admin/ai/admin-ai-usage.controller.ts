import { Readable } from "node:stream";

import { Controller, Get, Header, Query, StreamableFile } from "@nestjs/common";
import { aiUsageFilterSchema, aiUsageListQuerySchema } from "@wasfa/shared/schemas/admin-ai";

import { Audited, AuditCtx, type AuditScope } from "../../audit/audited.decorator.js";
import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAiUsageService } from "./admin-ai-usage.service.js";

class UsageListQueryDto extends createZodDto(aiUsageListQuerySchema) {}
class UsageFilterDto extends createZodDto(aiUsageFilterSchema) {}

/** The filters an export is recorded with: who asked for which slice, never any row. */
const EXPORT_AUDIT_FIELDS = ["task", "model", "outcome", "from", "to", "userId", "orgId"] as const;

@Controller("admin/ai/usage")
export class AdminAiUsageController {
  constructor(private readonly usage: AdminAiUsageService) {}

  @Get()
  @RequirePermission("usage.read")
  @RateLimit(120)
  list(@Query() query: UsageListQueryDto) {
    const { cursor, limit, ...filter } = query;
    return this.usage.list(filter, cursor, limit);
  }

  /** Totals over the same filters as the list (not only the page on screen). */
  @Get("totals")
  @RequirePermission("usage.read")
  @RateLimit(120)
  totals(@Query() query: UsageFilterDto) {
    return this.usage.totals(query);
  }

  @Get("export.csv")
  @RequirePermission("usage.read")
  @RateLimit(10)
  @Audited({
    action: "ai.usage.export",
    targetType: "ai_usage",
    fields: EXPORT_AUDIT_FIELDS,
  })
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="ai-usage.csv"')
  @Header("Cache-Control", "no-store")
  exportCsv(@Query() query: UsageFilterDto, @AuditCtx() audit: AuditScope): StreamableFile {
    audit.after = query;
    return new StreamableFile(Readable.from(this.usage.csv(query)));
  }
}
