import { Module } from "@nestjs/common";

import { PromotionsRepo } from "./promotions.repo.js";
import { PromotionsService } from "./promotions.service.js";

@Module({ providers: [PromotionsRepo, PromotionsService], exports: [PromotionsService] })
export class PromotionsModule {}
