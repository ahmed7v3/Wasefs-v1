import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";

import { AdminBillingMethodsController } from "./admin-billing-methods.controller.js";
import { AdminBillingMethodsRepo } from "./admin-billing-methods.repo.js";
import { AdminBillingMethodsService } from "./admin-billing-methods.service.js";

@Module({
  imports: [AuthModule],
  controllers: [AdminBillingMethodsController],
  providers: [AdminBillingMethodsRepo, AdminBillingMethodsService],
})
export class AdminBillingMethodsModule {}
