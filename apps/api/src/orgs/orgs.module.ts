import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { InvitesController } from "./invites.controller.js";
import { InvitesService } from "./invites.service.js";
import { OrgsController } from "./orgs.controller.js";
import { OrgsRepo } from "./orgs.repo.js";
import { OrgsService } from "./orgs.service.js";

/** Organizations, members and invitations (Task 1.7). Organizations are created by onboarding. */
@Module({
  imports: [AuthModule],
  controllers: [OrgsController, InvitesController],
  providers: [OrgsRepo, OrgsService, InvitesService],
  exports: [OrgsRepo],
})
export class OrgsModule {}
