import { Module } from "@nestjs/common";

import { AdminWithdrawalsController } from "./withdrawals.controller.js";
import { AdminWithdrawalsRepo } from "./withdrawals.repo.js";
import { AdminWithdrawalsService } from "./withdrawals.service.js";

/** `/admin/growth/withdrawals`: the review queue, approvals, payment and the weekly export (Task 3.12). */
@Module({
  controllers: [AdminWithdrawalsController],
  providers: [AdminWithdrawalsRepo, AdminWithdrawalsService],
})
export class AdminWithdrawalsModule {}
