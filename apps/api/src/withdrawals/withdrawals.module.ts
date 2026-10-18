import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";

import { MePayoutDestinationsController, MeWithdrawalsController } from "./withdrawals.controller.js";
import { WithdrawalsRepo } from "./withdrawals.repo.js";
import { WithdrawalsService } from "./withdrawals.service.js";

/** The caller's payout destinations and cash withdrawals (Task 3.12). */
@Module({
  imports: [AuthModule],
  controllers: [MePayoutDestinationsController, MeWithdrawalsController],
  providers: [WithdrawalsRepo, WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
