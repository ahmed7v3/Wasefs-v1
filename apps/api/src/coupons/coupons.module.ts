import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module.js";

import { CouponsController } from "./coupons.controller.js";
import { CouponsRepo } from "./coupons.repo.js";
import { CouponsService } from "./coupons.service.js";

@Module({
  imports: [BillingModule],
  controllers: [CouponsController],
  providers: [CouponsRepo, CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
