import { Module } from "@nestjs/common";

import { FlagsModule } from "../../flags/flags.module.js";

import { AdminFlagsController } from "./admin-flags.controller.js";
import { AdminFlagsRepo } from "./admin-flags.repo.js";
import { AdminFlagsService } from "./admin-flags.service.js";

/** Feature flag CRUD for admins (Task 1.10). */
@Module({
  imports: [FlagsModule],
  controllers: [AdminFlagsController],
  providers: [AdminFlagsRepo, AdminFlagsService],
})
export class AdminFlagsModule {}
