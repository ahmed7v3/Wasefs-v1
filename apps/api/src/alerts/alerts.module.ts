import { Module } from "@nestjs/common";

import { AlertsController } from "./alerts.controller.js";
import { AlertsRepo } from "./alerts.repo.js";
import { AdminAlertService } from "./alerts.service.js";

@Module({
  controllers: [AlertsController],
  providers: [AlertsRepo, AdminAlertService],
  exports: [AdminAlertService],
})
export class AlertsModule {}
