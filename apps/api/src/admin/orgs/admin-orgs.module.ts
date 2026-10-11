import { Module } from "@nestjs/common";

import { AdminOrgsController } from "./admin-orgs.controller.js";
import { AdminOrgsRepo } from "./admin-orgs.repo.js";
import { AdminOrgsService } from "./admin-orgs.service.js";

/** Organization list and detail for admins (Task 1.10). */
@Module({
  controllers: [AdminOrgsController],
  providers: [AdminOrgsRepo, AdminOrgsService],
})
export class AdminOrgsModule {}
