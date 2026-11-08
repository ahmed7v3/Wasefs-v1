import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { PlansModule } from "../plans/plans.module.js";

import { AdsController } from "./ads.controller.js";
import { AdsRepo } from "./ads.repo.js";
import { AdsService } from "./ads.service.js";

/** First-party ads (docs/ADS.md): public slot selection, signed tokens, impression and click counters. */
@Module({
  imports: [AuthModule, PlansModule],
  controllers: [AdsController],
  providers: [AdsRepo, AdsService],
  exports: [AdsService],
})
export class AdsModule {}
