import { Module } from "@nestjs/common";
import { NO_SUBSCRIPTION_HOOKS } from "@wasfa/db";

import { BillingModule } from "../billing/billing.module.js";
import { OrdersController } from "../orders/orders.controller.js";
import { OrdersService } from "../orders/orders.service.js";

import { GatewayRegistry } from "./gateway-registry.js";
import { PaymentsRepo } from "./payments.repo.js";
import { PAYMENT_HOOKS, PaymentsService } from "./payments.service.js";
import { WebhooksController } from "./webhooks.controller.js";

/** Orders, payments, provider webhooks and refunds (BILLING §5, Task 3.3). */
@Module({
  imports: [BillingModule],
  controllers: [OrdersController, WebhooksController],
  providers: [
    GatewayRegistry,
    PaymentsRepo,
    PaymentsService,
    OrdersService,
    // Task 3.5 (WP3) replaces this binding with the subscriptions service.
    { provide: PAYMENT_HOOKS, useValue: NO_SUBSCRIPTION_HOOKS },
  ],
  exports: [GatewayRegistry, PaymentsRepo, PaymentsService],
})
export class PaymentsModule {}
