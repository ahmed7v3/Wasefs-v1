import { Module } from "@nestjs/common";

import { AdminAuditModule } from "../audit/admin-audit.module.js";
import { AdminRolesModule } from "../roles/admin-roles.module.js";

import { AdminUsersController } from "./admin-users.controller.js";
import { AdminUsersRepo } from "./admin-users.repo.js";
import { AdminUsersService } from "./admin-users.service.js";

/** User search and detail, suspension and role assignment (Task 1.10). */
@Module({
  imports: [AdminAuditModule, AdminRolesModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersRepo, AdminUsersService],
})
export class AdminUsersModule {}
