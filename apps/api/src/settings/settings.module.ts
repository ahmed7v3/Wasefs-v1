import { Global, Module } from "@nestjs/common";

import { SettingsController } from "./settings.controller.js";
import { SettingsRepo } from "./settings.repo.js";
import { SettingsService } from "./settings.service.js";

/** Typed, cached site settings (Task 1.8). Global: auth, access control and phone read them. */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsRepo, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
