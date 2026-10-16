import { Module } from "@nestjs/common";

import { PaymentsModule } from "../../payments/payments.module.js";

import { AdminBillingGatewaysController } from "./admin-billing-gateways.controller.js";
import { AdminBillingGatewaysRepo } from "./admin-billing-gateways.repo.js";
import { AdminBillingGatewaysService } from "./admin-billing-gateways.service.js";

@Module({
  imports: [PaymentsModule],
  controllers: [AdminBillingGatewaysController],
  providers: [AdminBillingGatewaysRepo, AdminBillingGatewaysService],
})
export class AdminBillingGatewaysModule {}
