import { Module } from "@nestjs/common";

import { ChatRepo } from "../../chat/chat.repo.js";
import { CreditsModule } from "../../credits/credits.module.js";
import { FilesModule } from "../../files/files.module.js";
import { PaymentsModule } from "../../payments/payments.module.js";
import { PlansModule } from "../../plans/plans.module.js";
import { RxModule } from "../../rx/rx.module.js";
import { AdminAuditModule } from "../audit/admin-audit.module.js";
import { AdminRolesModule } from "../roles/admin-roles.module.js";

import { AdminUsersController } from "./admin-users.controller.js";
import { AdminUsersRepo } from "./admin-users.repo.js";
import { AdminUsersService } from "./admin-users.service.js";
import { AdminUser360Controller } from "./user-360.controller.js";
import { AdminUser360Repo } from "./user-360.repo.js";
import { AdminUser360Service } from "./user-360.service.js";
import { AdminUserActionsController } from "./user-actions.controller.js";
import { AdminUserActionsRepo } from "./user-actions.repo.js";
import { AdminUserActionsService } from "./user-actions.service.js";
import { AdminUserNotesController } from "./user-notes.controller.js";
import { AdminUserNotesRepo } from "./user-notes.repo.js";
import { AdminUserNotesService } from "./user-notes.service.js";
import { AdminUserPhiController } from "./user-phi.controller.js";
import { AdminUserPhiRepo } from "./user-phi.repo.js";
import { AdminUserPhiService } from "./user-phi.service.js";
import {
  AdminOrgPlanChangeController,
  AdminUserPlanChangeController,
} from "./user-plan-change.controller.js";
import { AdminPlanChangeRepo } from "./user-plan-change.repo.js";
import { AdminPlanChangeService } from "./user-plan-change.service.js";

/**
 * User search and detail, suspension and role assignment (Task 1.10), and the user 360 page
 * (Task 3.15): summary, timeline, billing, credits, referrals, health-data access, notes, the
 * change-plan dialog and the quick actions.
 */
@Module({
  imports: [
    AdminAuditModule,
    AdminRolesModule,
    CreditsModule,
    FilesModule,
    PaymentsModule,
    PlansModule,
    RxModule,
  ],
  controllers: [
    AdminUsersController,
    AdminUser360Controller,
    AdminUserPhiController,
    AdminUserNotesController,
    AdminUserPlanChangeController,
    AdminOrgPlanChangeController,
    AdminUserActionsController,
  ],
  providers: [
    AdminUsersRepo,
    AdminUsersService,
    AdminUser360Repo,
    AdminUser360Service,
    AdminUserPhiRepo,
    AdminUserPhiService,
    AdminUserNotesRepo,
    AdminUserNotesService,
    AdminPlanChangeRepo,
    AdminPlanChangeService,
    AdminUserActionsRepo,
    AdminUserActionsService,
    // A plain reader over the database; the transcript viewer uses it scoped to the viewed user.
    ChatRepo,
  ],
})
export class AdminUsersModule {}
