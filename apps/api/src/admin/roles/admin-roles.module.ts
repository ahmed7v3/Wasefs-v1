import { Module } from "@nestjs/common";

import { AdminPermissionsController, AdminRolesController } from "./admin-roles.controller.js";
import { AdminRolesRepo } from "./admin-roles.repo.js";
import { AdminRolesService } from "./admin-roles.service.js";

/** Role editor and permission catalog (Task 1.10). Exported for the role grant rules. */
@Module({
  controllers: [AdminRolesController, AdminPermissionsController],
  providers: [AdminRolesRepo, AdminRolesService],
  exports: [AdminRolesService],
})
export class AdminRolesModule {}
