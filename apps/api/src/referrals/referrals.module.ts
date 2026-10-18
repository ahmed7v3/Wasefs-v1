import { Module } from "@nestjs/common";

import { InviteLinkController, MeReferralController } from "./referrals.controller.js";
import { ReferralsRepo } from "./referrals.repo.js";
import { ReferralsService } from "./referrals.service.js";

/** Invite codes, the vanity edit and the `/r/<code>` landing (Task 3.11). */
@Module({
  controllers: [MeReferralController, InviteLinkController],
  providers: [ReferralsRepo, ReferralsService],
  exports: [ReferralsService, ReferralsRepo],
})
export class ReferralsModule {}
