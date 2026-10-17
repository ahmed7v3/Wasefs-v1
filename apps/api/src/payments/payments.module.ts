import { Module } from "@nestjs/common";
import { NO_SUBSCRIPTION_HOOKS } from "@wasfa/db";

import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { FilesModule } from "../files/files.module.js";
import { OrdersController } from "../orders/orders.controller.js";
import { OrdersService } from "../orders/orders.service.js";

import { GatewayRegistry } from "./gateway-registry.js";
import { ManualPaymentsController } from "./manual/manual-payments.controller.js";
import { ManualPaymentsRepo } from "./manual/manual-payments.repo.js";
import { ManualPaymentsService } from "./manual/manual-payments.service.js";
import { PaymentsRepo } from "./payments.repo.js";
import { PAYMENT_HOOKS, PaymentsService } from "./payments.service.js";
import { WebhooksController } from "./webhooks.controller.js";

/** Orders, payments, provider webhooks and refunds (BILLING §5, Task 3.3). */
@Module({
  imports: [AuthModule, BillingModule, FilesModule],
  controllers: [OrdersController, WebhooksController, ManualPaymentsController],
  providers: [
    GatewayRegistry,
    PaymentsRepo,
    PaymentsService,
    OrdersService,
    ManualPaymentsRepo,
    ManualPaymentsService,
    // Task 3.5 (WP3) replaces this binding with the subscriptions service.
    { provide: PAYMENT_HOOKS, useValue: NO_SUBSCRIPTION_HOOKS },
  ],
  exports: [GatewayRegistry, PaymentsRepo, PaymentsService, PAYMENT_HOOKS],
})
export class PaymentsModule {}
