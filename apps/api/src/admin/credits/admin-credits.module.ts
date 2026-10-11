import { Module } from "@nestjs/common";

import { CreditsModule } from "../../credits/credits.module.js";
import { PlansModule } from "../../plans/plans.module.js";

import { AdminCreditsController } from "./admin-credits.controller.js";
import { AdminCreditsService } from "./admin-credits.service.js";

/** Wallet list, ledger view and manual adjustments under `/admin/credits` (Task 2.2). */
@Module({
  imports: [CreditsModule, PlansModule],
  controllers: [AdminCreditsController],
  providers: [AdminCreditsService],
})
export class AdminCreditsModule {}
