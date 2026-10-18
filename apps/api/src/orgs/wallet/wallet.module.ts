import { Module } from "@nestjs/common";

import { CreditsModule } from "../../credits/credits.module.js";
import { OrgsModule } from "../orgs.module.js";

import { MeCreditsController } from "./me-credits.controller.js";
import { PayerService } from "./payer.service.js";
import { WalletViewService } from "./wallet-view.service.js";
import { OrgWalletRepo } from "./wallet.repo.js";

/**
 * Organization wallets (Task 3.9): which wallet pays in an organization context, the member caps
 * behind it, and `GET /me/credits` with `wallets[]` and `payer`.
 */
@Module({
  imports: [CreditsModule, OrgsModule],
  controllers: [MeCreditsController],
  providers: [PayerService, WalletViewService, OrgWalletRepo],
  exports: [PayerService, OrgWalletRepo],
})
export class OrgWalletModule {}
