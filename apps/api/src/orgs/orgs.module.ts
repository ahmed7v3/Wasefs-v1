import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { PlansModule } from "../plans/plans.module.js";

import { InvitesController } from "./invites.controller.js";
import { InvitesService } from "./invites.service.js";
import { OrgsController } from "./orgs.controller.js";
import { OrgsRepo } from "./orgs.repo.js";
import { OrgsService } from "./orgs.service.js";
import { DealSeatLimitSource, PlanSeatLimitSource, SEAT_LIMIT_SOURCE } from "./seats/seat-limit.js";

/** Organizations, members and invitations (Task 1.7). Organizations are created by onboarding. */
@Module({
  imports: [AuthModule, PlansModule],
  controllers: [OrgsController, InvitesController],
  providers: [
    OrgsRepo,
    OrgsService,
    InvitesService,
    PlanSeatLimitSource,
    { provide: SEAT_LIMIT_SOURCE, useClass: DealSeatLimitSource },
  ],
  exports: [OrgsRepo, OrgsService, SEAT_LIMIT_SOURCE],
})
export class OrgsModule {}
