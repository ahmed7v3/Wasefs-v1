import { Controller, Get, Query } from "@nestjs/common";
import { aiOverviewQuerySchema } from "@wasfa/shared/schemas/admin-ai";

import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";
import { createZodDto } from "../../common/validation.js";

import { AdminAiOverviewService } from "./admin-ai-overview.service.js";

class OverviewQueryDto extends createZodDto(aiOverviewQuerySchema) {}

@Controller("admin/ai/overview")
export class AdminAiOverviewController {
  constructor(private readonly overview: AdminAiOverviewService) {}

  // Spend and call volumes: part of "usage", so `usage.read`, not just `ai.read`.
  @Get()
  @RequirePermission("usage.read")
  @RateLimit(60)
  get(@Query() query: OverviewQueryDto) {
    return this.overview.overview(query.days);
  }
}
