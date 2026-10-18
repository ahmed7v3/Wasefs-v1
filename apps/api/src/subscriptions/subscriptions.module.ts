import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";

import { SubscriptionsController } from "./subscriptions.controller.js";
import { SubscriptionsRepo } from "./subscriptions.repo.js";
import { SubscriptionsService } from "./subscriptions.service.js";

/**
 * The customer's subscription (BILLING §7): view, cancel and resume, trials, the renew quote, the
 * order history and receipts. Activation and refunds run inside payments through `PAYMENT_HOOKS`.
 */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsRepo, SubscriptionsService],
  exports: [SubscriptionsRepo, SubscriptionsService],
})
export class SubscriptionsModule {}
