import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { AdminEarlyAccessController } from "./admin-early-access.controller.js";
import { AdminEarlyAccessRepo } from "./admin-early-access.repo.js";
import { AdminEarlyAccessService } from "./admin-early-access.service.js";
import { EarlyAccessController } from "./early-access.controller.js";
import { EarlyAccessRepo } from "./early-access.repo.js";
import { EarlyAccessService } from "./early-access.service.js";

/** Pre-launch waitlist on `early.wasfa.online`: public capture and funnel, admin dashboard data. */
@Module({
  imports: [AuthModule],
  controllers: [EarlyAccessController, AdminEarlyAccessController],
  providers: [EarlyAccessRepo, EarlyAccessService, AdminEarlyAccessRepo, AdminEarlyAccessService],
})
export class EarlyAccessModule {}
