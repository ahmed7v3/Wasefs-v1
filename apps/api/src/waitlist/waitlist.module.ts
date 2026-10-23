import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { AdminWaitlistController } from "./admin-waitlist.controller.js";
import { WaitlistController } from "./waitlist.controller.js";
import { WaitlistRepo } from "./waitlist.repo.js";
import { WaitlistService } from "./waitlist.service.js";

/** "Tell me when the apps launch" (BRAND-AND-HOMEPAGE §3.6): the public form and the admin list. */
@Module({
  imports: [AuthModule],
  controllers: [WaitlistController, AdminWaitlistController],
  providers: [WaitlistRepo, WaitlistService],
})
export class WaitlistModule {}
