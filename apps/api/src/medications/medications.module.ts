import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { SettingsModule } from "../settings/settings.module.js";

import { MedicationsController } from "./medications.controller.js";
import { MedicationsRepo } from "./medications.repo.js";
import { MedicationsService } from "./medications.service.js";

/** Medication search and details for users (`/medications`, docs/MEDICATIONS.md section 6). */
@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [MedicationsController],
  providers: [MedicationsRepo, MedicationsService],
})
export class MedicationsModule {}
