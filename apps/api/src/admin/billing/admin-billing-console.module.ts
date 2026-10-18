import { Module } from "@nestjs/common";

import { PaymentsModule } from "../../payments/payments.module.js";

import { AdminBillingCatalogController } from "./admin-billing-catalog.controller.js";
import { AdminBillingCatalogRepo } from "./admin-billing-catalog.repo.js";
import { AdminBillingCatalogService } from "./admin-billing-catalog.service.js";
import { AdminBillingOverviewController } from "./admin-billing-overview.controller.js";
import { AdminBillingOverviewRepo } from "./admin-billing-overview.repo.js";
import { AdminBillingOverviewService } from "./admin-billing-overview.service.js";
import { AdminBillingRecordsController } from "./admin-billing-records.controller.js";
import { AdminBillingRecordsRepo } from "./admin-billing-records.repo.js";
import { AdminBillingRecordsService } from "./admin-billing-records.service.js";
import { AdminBillingSubscriptionsController } from "./admin-billing-subscriptions.controller.js";
import { AdminBillingSubscriptionsRepo } from "./admin-billing-subscriptions.repo.js";
import { AdminBillingSubscriptionsService } from "./admin-billing-subscriptions.service.js";

@Module({
  imports: [PaymentsModule],
  controllers: [
    AdminBillingOverviewController,
    AdminBillingRecordsController,
    AdminBillingSubscriptionsController,
    AdminBillingCatalogController,
  ],
  providers: [
    AdminBillingOverviewRepo,
    AdminBillingOverviewService,
    AdminBillingRecordsRepo,
    AdminBillingRecordsService,
    AdminBillingSubscriptionsRepo,
    AdminBillingSubscriptionsService,
    AdminBillingCatalogRepo,
    AdminBillingCatalogService,
  ],
})
export class AdminBillingConsoleModule {}
