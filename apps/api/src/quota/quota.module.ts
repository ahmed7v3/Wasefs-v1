import { Module } from "@nestjs/common";

import { PlansModule } from "../plans/plans.module.js";

import { QuotaService } from "./quota.service.js";

/** Plan entitlements, daily caps and the one-at-a-time lock (Task 2.2). */
@Module({
  imports: [PlansModule],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
