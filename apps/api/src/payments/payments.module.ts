import { Module } from "@nestjs/common";
import { SUBSCRIPTION_HOOKS } from "@wasfa/db";

import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { FilesModule } from "../files/files.module.js";
import { OrdersController } from "../orders/orders.controller.js";
import { OrdersService } from "../orders/orders.service.js";
import { OrgsModule } from "../orgs/orgs.module.js";

import { GatewayRegistry } from "./gateway-registry.js";
import { ManualPaymentsController } from "./manual/manual-payments.controller.js";
import { ManualPaymentsRepo } from "./manual/manual-payments.repo.js";
import { ManualPaymentsService } from "./manual/manual-payments.service.js";
import { PaymentsRepo } from "./payments.repo.js";
import { PAYMENT_HOOKS, PaymentsService } from "./payments.service.js";
import { WebhooksController } from "./webhooks.controller.js";

/** Orders, payments, provider webhooks and refunds (BILLING §5, Task 3.3). */
@Module({
  imports: [AuthModule, BillingModule, FilesModule, OrgsModule],
  controllers: [OrdersController, WebhooksController, ManualPaymentsController],
  providers: [
    GatewayRegistry,
    PaymentsRepo,
    PaymentsService,
    OrdersService,
    ManualPaymentsRepo,
    ManualPaymentsService,
    // Activation and refunds create, extend, switch or shorten the subscription period.
    { provide: PAYMENT_HOOKS, useValue: SUBSCRIPTION_HOOKS },
  ],
  // Orders and manual proofs are also driven by the WhatsApp agent (WA-AGENT.md).
  exports: [
    GatewayRegistry,
    PaymentsRepo,
    PaymentsService,
    OrdersService,
    ManualPaymentsService,
    PAYMENT_HOOKS,
  ],
})
export class PaymentsModule {}
