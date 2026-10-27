import { Module } from "@nestjs/common";

import { AdminAiModule } from "./ai/admin-ai.module.js";
import { AdminAuditModule } from "./audit/admin-audit.module.js";
import { AdminBillingConsoleModule } from "./billing/admin-billing-console.module.js";
import { AdminBillingGatewaysModule } from "./billing/admin-billing-gateways.module.js";
import { AdminBillingMethodsModule } from "./billing/admin-billing-methods.module.js";
import { AdminBillingPaymentsModule } from "./billing/admin-billing-payments.module.js";
import { AdminBillingPricingModule } from "./billing/admin-billing-pricing.module.js";
import { AdminBrandingModule } from "./branding/admin-branding.module.js";
import { AdminCreditsModule } from "./credits/admin-credits.module.js";
import { AdminDrugsModule } from "./drugs/admin-drugs.module.js";
import { AdminEvalsModule } from "./evals/admin-evals.module.js";
import { AdminFlagsModule } from "./flags/admin-flags.module.js";
import { AdminDealsModule } from "./growth/admin-deals.module.js";
import { AdminReferralsModule } from "./growth/admin-referrals.module.js";
import { AdminWithdrawalsModule } from "./growth/withdrawals.module.js";
import { AdminIssuesModule } from "./issues/admin-issues.module.js";
import { AdminOrgsModule } from "./orgs/admin-orgs.module.js";
import { AdminPlansModule } from "./plans/admin-plans.module.js";
import { AdminRolesModule } from "./roles/admin-roles.module.js";
import { AdminSearchModule } from "./search/admin-search.module.js";
import { AdminSettingsModule } from "./settings/admin-settings.module.js";
import { AdminStatsModule } from "./stats/admin-stats.module.js";
import { AdminUsersModule } from "./users/admin-users.module.js";
import { AdminWaAgentModule } from "./wa-agent/admin-wa-agent.module.js";
import { AdminWhatsappModule } from "./whatsapp/admin-whatsapp.module.js";

/**
 * Admin v1 (Task 1.10): everything under `/admin/*`. Each route declares `@RequirePermission`
 * (the permissions guard refuses an `/admin` route without one and requires a two-factor session).
 */
@Module({
  imports: [
    AdminStatsModule,
    AdminUsersModule,
    AdminOrgsModule,
    AdminRolesModule,
    AdminSearchModule,
    AdminSettingsModule,
    AdminBrandingModule,
    AdminFlagsModule,
    AdminAuditModule,
    AdminIssuesModule,
    AdminWhatsappModule,
    AdminWaAgentModule,
    AdminPlansModule,
    AdminCreditsModule,
    AdminAiModule,
    AdminBillingGatewaysModule,
    AdminBillingConsoleModule,
    AdminBillingPaymentsModule,
    AdminBillingMethodsModule,
    AdminBillingPricingModule,
    AdminDealsModule,
    AdminReferralsModule,
    AdminWithdrawalsModule,
    AdminDrugsModule,
    AdminEvalsModule,
  ],
})
export class AdminModule {}
