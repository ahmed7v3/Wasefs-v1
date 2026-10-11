import { Module } from "@nestjs/common";

import { AdminStatsController } from "./admin-stats.controller.js";
import { AdminStatsRepo } from "./admin-stats.repo.js";
import { AdminStatsService } from "./admin-stats.service.js";

/** Dashboard counts (Task 1.10). */
@Module({
  controllers: [AdminStatsController],
  providers: [AdminStatsRepo, AdminStatsService],
})
export class AdminStatsModule {}
