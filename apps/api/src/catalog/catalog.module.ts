import { Module } from "@nestjs/common";

import { BillingModule } from "../billing/billing.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { PlansModule } from "../plans/plans.module.js";

import { CatalogController } from "./catalog.controller.js";
import { CatalogRepo } from "./catalog.repo.js";
import { CatalogService } from "./catalog.service.js";
import { RecommendationController } from "./recommendation.controller.js";

/** The public pricing data (`GET /catalog`) and plan advice (`GET /me/recommendation`), Task 3.2. */
@Module({
  imports: [BillingModule, CreditsModule, PlansModule],
  controllers: [CatalogController, RecommendationController],
  providers: [CatalogRepo, CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
