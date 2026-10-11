import { Module } from "@nestjs/common";

import { AdminAuditModule } from "./audit/admin-audit.module.js";
import { AdminFlagsModule } from "./flags/admin-flags.module.js";
import { AdminIssuesModule } from "./issues/admin-issues.module.js";
import { AdminOrgsModule } from "./orgs/admin-orgs.module.js";
import { AdminRolesModule } from "./roles/admin-roles.module.js";
import { AdminSettingsModule } from "./settings/admin-settings.module.js";
import { AdminStatsModule } from "./stats/admin-stats.module.js";
import { AdminUsersModule } from "./users/admin-users.module.js";

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
    AdminSettingsModule,
    AdminFlagsModule,
    AdminAuditModule,
    AdminIssuesModule,
  ],
})
export class AdminModule {}
