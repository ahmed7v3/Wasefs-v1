import { Module } from "@nestjs/common";

import { OrgsModule } from "../orgs.module.js";

import {
  AdminJoinLinksController,
  OrgJoinLinksController,
  PublicJoinController,
} from "./join-links.controller.js";
import { JoinLinksRepo } from "./join-links.repo.js";
import { JoinLinksService } from "./join-links.service.js";

/** Organization join links, the `/join/<slug>` landing and acceptance, and join approvals (Task 3.9). */
@Module({
  imports: [OrgsModule],
  controllers: [OrgJoinLinksController, PublicJoinController, AdminJoinLinksController],
  providers: [JoinLinksRepo, JoinLinksService],
  exports: [JoinLinksRepo],
})
export class OrgJoinLinksModule {}
