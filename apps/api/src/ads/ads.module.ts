import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { PlansModule } from "../plans/plans.module.js";

import { AdminAdsController } from "./admin-ads.controller.js";
import { AdminAdsRepo } from "./admin-ads.repo.js";
import { AdminAdsService } from "./admin-ads.service.js";
import { AdsWhatsappService } from "./ads-whatsapp.service.js";
import { AdsController } from "./ads.controller.js";
import { AdsRepo } from "./ads.repo.js";
import { AdsService } from "./ads.service.js";

/** First-party ads (docs/ADS.md): public slot selection, signed tokens, impression and click counters. */
@Module({
  imports: [AuthModule, PlansModule],
  controllers: [AdsController, AdminAdsController],
  providers: [AdsRepo, AdsService, AdsWhatsappService, AdminAdsRepo, AdminAdsService],
  exports: [AdsService, AdsWhatsappService],
})
export class AdsModule {}
