import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";

import { OrgDashboardService } from "./dashboard/org-dashboard.service.js";
import { OrgJoinLinksModule } from "./join-links/join-links.module.js";
import { LeadsController } from "./leads/leads.controller.js";
import { LeadsRepo } from "./leads/leads.repo.js";
import { LeadsService } from "./leads/leads.service.js";
import { MemberLimitsRepo } from "./limits/member-limits.repo.js";
import { MemberLimitsService } from "./limits/member-limits.service.js";
import { OrgBillingController } from "./org-billing.controller.js";
import { OrgsModule } from "./orgs.module.js";
import { OrgWalletModule } from "./wallet/wallet.module.js";

/**
 * Organizations as billable institutions (Task 3.9): the dashboard and usage export, member
 * credit caps, the org-admin views of subscription, orders and receipts, and the institution lead form.
 */
@Module({
  imports: [
    AuthModule,
    OrgsModule,
    OrgWalletModule,
    OrgJoinLinksModule,
    PlansModule,
    SubscriptionsModule,
  ],
  controllers: [OrgBillingController, LeadsController],
  providers: [OrgDashboardService, MemberLimitsRepo, MemberLimitsService, LeadsRepo, LeadsService],
})
export class OrgBillingModule {}
