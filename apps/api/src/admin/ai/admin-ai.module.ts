import { Module } from "@nestjs/common";

import { AdminAiModelsController } from "./admin-ai-models.controller.js";
import { AdminAiModelsRepo } from "./admin-ai-models.repo.js";
import { AdminAiModelsService } from "./admin-ai-models.service.js";
import { AdminAiPriceSyncService } from "./admin-ai-price-sync.service.js";
import { AdminAiProvidersController } from "./admin-ai-providers.controller.js";
import { AdminAiProvidersRepo } from "./admin-ai-providers.repo.js";
import { AdminAiProvidersService } from "./admin-ai-providers.service.js";
import { AdminAiRoutesController } from "./admin-ai-routes.controller.js";
import { AdminAiRoutesRepo } from "./admin-ai-routes.repo.js";
import { AdminAiRoutesService } from "./admin-ai-routes.service.js";
import { AdminAiSettingsController } from "./admin-ai-settings.controller.js";
import { AdminAiSettingsRepo } from "./admin-ai-settings.repo.js";
import { AdminAiSettingsService } from "./admin-ai-settings.service.js";
import { AiGatewayFactory } from "./ai-gateway.factory.js";

/** AI control plane under `/admin/ai`: providers and keys, models and prices, routes, settings (Task 2.4). */
@Module({
  controllers: [
    AdminAiProvidersController,
    AdminAiModelsController,
    AdminAiRoutesController,
    AdminAiSettingsController,
  ],
  providers: [
    AiGatewayFactory,
    AdminAiProvidersRepo,
    AdminAiModelsRepo,
    AdminAiRoutesRepo,
    AdminAiSettingsRepo,
    AdminAiProvidersService,
    AdminAiModelsService,
    AdminAiPriceSyncService,
    AdminAiRoutesService,
    AdminAiSettingsService,
  ],
})
export class AdminAiModule {}
