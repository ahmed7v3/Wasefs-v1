import { Controller, Get } from "@nestjs/common";

import { RequirePermission } from "../../common/permissions.guard.js";
import { RateLimit } from "../../common/rate-limit.js";

import { AdminStatsService } from "./admin-stats.service.js";

@Controller("admin/stats")
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  @RequirePermission("users.read")
  @RateLimit(120)
  get() {
    return this.stats.stats();
  }
}
