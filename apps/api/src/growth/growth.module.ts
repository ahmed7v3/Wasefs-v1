import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { OrgWalletModule } from "../orgs/wallet/wallet.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { RxModule } from "../rx/rx.module.js";

import { MeGrowthController, PublicGrowthController } from "./growth.controller.js";
import { GrowthRepo } from "./growth.repo.js";
import { GrowthService } from "./growth.service.js";
import { PromptsService } from "./prompts.service.js";
import { TasteService } from "./taste.service.js";

/**
 * The conversion engine (Phase 3, Task 3.14; docs/GROWTH-STRATEGY.md): value-moment prompts, the
 * taste of Deep mode, personal offers, the value ledger and social proof, first-party funnel events,
 * experiment arms, and the marketing unsubscribe. Lifecycle mail and offer creation run in the worker.
 */
@Module({
  imports: [AuthModule, CreditsModule, OrgWalletModule, PlansModule, RxModule],
  controllers: [MeGrowthController, PublicGrowthController],
  providers: [GrowthRepo, GrowthService, PromptsService, TasteService],
  exports: [GrowthRepo],
})
export class GrowthModule {}
