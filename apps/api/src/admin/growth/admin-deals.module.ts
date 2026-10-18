import { Module } from "@nestjs/common";

import { BillingModule } from "../../billing/billing.module.js";

import { AdminDealsController } from "./admin-deals.controller.js";
import { AdminDealsRepo } from "./admin-deals.repo.js";
import { AdminDealsService } from "./admin-deals.service.js";

/** `/admin/growth/deals`: the deals console API (Task 3.10). */
@Module({
  imports: [BillingModule],
  controllers: [AdminDealsController],
  providers: [AdminDealsRepo, AdminDealsService],
  exports: [AdminDealsService],
})
export class AdminDealsModule {}
