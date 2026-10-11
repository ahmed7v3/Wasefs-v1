import { Module } from "@nestjs/common";

import { CreditsModule } from "../../credits/credits.module.js";

import { AdminPlansController } from "./admin-plans.controller.js";
import { AdminPlansRepo } from "./admin-plans.repo.js";
import { AdminPlansService } from "./admin-plans.service.js";

/** Plan editor, entitlements and manual assignments under `/admin/plans` (Task 2.2). */
@Module({
  imports: [CreditsModule],
  controllers: [AdminPlansController],
  providers: [AdminPlansRepo, AdminPlansService],
})
export class AdminPlansModule {}
