import { Module } from "@nestjs/common";

import { BillingModule } from "../../billing/billing.module.js";
import { CouponsModule } from "../../coupons/coupons.module.js";
import { PromotionsModule } from "../../promotions/promotions.module.js";

import { AdminBillingCouponsController } from "./admin-billing-coupons.controller.js";
import { AdminBillingPromotionsController } from "./admin-billing-promotions.controller.js";
import { AdminBillingSimulateController } from "./admin-billing-simulate.controller.js";

@Module({
  imports: [BillingModule, CouponsModule, PromotionsModule],
  controllers: [
    AdminBillingPromotionsController,
    AdminBillingCouponsController,
    AdminBillingSimulateController,
  ],
})
export class AdminBillingPricingModule {}
