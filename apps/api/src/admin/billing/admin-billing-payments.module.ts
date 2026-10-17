import { Module } from "@nestjs/common";

import { FilesModule } from "../../files/files.module.js";
import { PaymentsModule } from "../../payments/payments.module.js";

import { AdminBillingPaymentsController } from "./admin-billing-payments.controller.js";
import { AdminBillingPaymentsRepo } from "./admin-billing-payments.repo.js";
import { AdminBillingPaymentsService } from "./admin-billing-payments.service.js";

@Module({
  imports: [PaymentsModule, FilesModule],
  controllers: [AdminBillingPaymentsController],
  providers: [AdminBillingPaymentsRepo, AdminBillingPaymentsService],
})
export class AdminBillingPaymentsModule {}
