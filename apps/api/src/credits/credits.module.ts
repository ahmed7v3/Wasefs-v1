import { Module } from "@nestjs/common";

import { PlansModule } from "../plans/plans.module.js";

import { CreditsRepo } from "./credits.repo.js";
import { CreditsService } from "./credits.service.js";
import { MeCreditsController } from "./me-credits.controller.js";

/** Wallets, the credit ledger and `GET /me/credits` (Task 2.2). */
@Module({
  imports: [PlansModule],
  controllers: [MeCreditsController],
  providers: [CreditsRepo, CreditsService],
  exports: [CreditsService, CreditsRepo],
})
export class CreditsModule {}
