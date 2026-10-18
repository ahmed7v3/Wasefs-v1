import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { ReferralsModule } from "../referrals/referrals.module.js";

import { MeRewardsController } from "./rewards.controller.js";
import { RewardsRepo } from "./rewards.repo.js";
import { RewardsService } from "./rewards.service.js";

/** The caller's points and rewards page, activity and conversion to credits (Task 3.11). */
@Module({
  imports: [AuthModule, ReferralsModule],
  controllers: [MeRewardsController],
  providers: [RewardsRepo, RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
