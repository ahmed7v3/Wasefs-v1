import { Module } from "@nestjs/common";

import { PlansModule } from "../plans/plans.module.js";
import { QuotaModule } from "../quota/quota.module.js";

import { CreditsRepo } from "./credits.repo.js";
import { CreditsService } from "./credits.service.js";
import { MeCreditsController } from "./me-credits.controller.js";
import { MeUsageController } from "./me-usage.controller.js";

/** Wallets, the credit ledger and `GET /me/credits` and `GET /me/usage` (Task 2.2). */
@Module({
  imports: [PlansModule, QuotaModule],
  controllers: [MeCreditsController, MeUsageController],
  providers: [CreditsRepo, CreditsService],
  exports: [CreditsService, CreditsRepo],
})
export class CreditsModule {}
