import { Module } from "@nestjs/common";

import { AdminSettingsController } from "./admin-settings.controller.js";
import { AdminSettingsRepo } from "./admin-settings.repo.js";
import { AdminSettingsService } from "./admin-settings.service.js";

/** Settings read/write by registry key for admins (Task 1.10). `SettingsService` is global. */
@Module({
  controllers: [AdminSettingsController],
  providers: [AdminSettingsRepo, AdminSettingsService],
})
export class AdminSettingsModule {}
