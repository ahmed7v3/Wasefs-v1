import { Readable } from "node:stream";

import { Controller, Get, Header, Query, StreamableFile } from "@nestjs/common";
import { adminAppWaitlistQuerySchema } from "@wasfa/shared/schemas/public-site";

import { AuditCtx, Audited, type AuditScope } from "../audit/audited.decorator.js";
import { RequirePermission } from "../common/permissions.guard.js";
import { RateLimit } from "../common/rate-limit.js";
import { createZodDto } from "../common/validation.js";

import { WaitlistService } from "./waitlist.service.js";

class ListQueryDto extends createZodDto(adminAppWaitlistQuerySchema) {}

/** Who asked to be told when the apps launch (read-only; the addresses are personal data). */
@Controller("admin/app-waitlist")
export class AdminWaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  @RequirePermission("settings.read")
  @RateLimit(60)
  list(@Query() query: ListQueryDto) {
    return this.waitlist.list(query);
  }

  /** Whole list as CSV. Audited: it is an export of personal data. */
  @Get("export.csv")
  @RequirePermission("settings.read")
  @RateLimit(10)
  @Audited({ action: "app_waitlist.export", targetType: "app_waitlist" })
  @Header("Cache-Control", "no-store")
  async csv(@AuditCtx() audit: AuditScope): Promise<StreamableFile> {
    const lines = await this.waitlist.csv();
    audit.after = { rows: lines.length - 1 };
    return new StreamableFile(Readable.from(lines), {
      type: "text/csv; charset=utf-8",
      disposition: 'attachment; filename="app-waitlist.csv"',
    });
  }
}
