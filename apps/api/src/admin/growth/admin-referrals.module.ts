import { Module } from "@nestjs/common";

import { AdminDealsModule } from "./admin-deals.module.js";
import { AdminExperimentsController } from "./admin-experiments.controller.js";
import { AdminExperimentsRepo } from "./admin-experiments.repo.js";
import { AdminExperimentsService } from "./admin-experiments.service.js";
import { AdminFraudController } from "./admin-fraud.controller.js";
import { AdminFraudRepo } from "./admin-fraud.repo.js";
import { AdminFraudService } from "./admin-fraud.service.js";
import { AdminReferralCodesController } from "./admin-referral-codes.controller.js";
import { AdminReferralCodesRepo } from "./admin-referral-codes.repo.js";
import { AdminReferralCodesService } from "./admin-referral-codes.service.js";
import { AdminReferralsController } from "./admin-referrals.controller.js";
import { AdminReferralsRepo } from "./admin-referrals.repo.js";
import { AdminReferralsService } from "./admin-referrals.service.js";
import { AdminRewardConfigController } from "./admin-reward-config.controller.js";
import { AdminRewardConfigRepo } from "./admin-reward-config.repo.js";
import { AdminRewardConfigService } from "./admin-reward-config.service.js";

/**
 * `/admin/growth/{referrals,programs,rules,tiers,codes,fraud,settings}`: the referrals and rewards
 * console API (Task 3.13). Codes attach deals through the deals service.
 */
@Module({
  imports: [AdminDealsModule],
  controllers: [
    AdminReferralsController,
    AdminRewardConfigController,
    AdminReferralCodesController,
    AdminFraudController,
    AdminExperimentsController,
  ],
  providers: [
    AdminExperimentsRepo,
    AdminExperimentsService,
    AdminReferralsRepo,
    AdminReferralsService,
    AdminRewardConfigRepo,
    AdminRewardConfigService,
    AdminReferralCodesRepo,
    AdminReferralCodesService,
    AdminFraudRepo,
    AdminFraudService,
  ],
})
export class AdminReferralsModule {}
