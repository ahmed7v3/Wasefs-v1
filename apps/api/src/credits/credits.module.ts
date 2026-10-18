import { Module } from "@nestjs/common";

import { PlansModule } from "../plans/plans.module.js";
import { QuotaModule } from "../quota/quota.module.js";

import { CreditsRepo } from "./credits.repo.js";
import { CreditsService } from "./credits.service.js";
import { MeUsageController } from "./me-usage.controller.js";

/** Wallets, the credit ledger and `GET /me/usage` (Task 2.2); `GET /me/credits` is `OrgWalletModule`'s since Task 3.9. */
@Module({
  imports: [PlansModule, QuotaModule],
  controllers: [MeUsageController],
  providers: [CreditsRepo, CreditsService],
  exports: [CreditsService, CreditsRepo],
})
export class CreditsModule {}
