import { Module } from "@nestjs/common";

import { AiRuntimeModule } from "../../ai-runtime/ai-runtime.module.js";
import { AuthModule } from "../../auth/auth.module.js";
import { ChatImages } from "../../chat/chat-images.js";
import { FilesModule } from "../../files/files.module.js";

import { AdminAiModelsController } from "./admin-ai-models.controller.js";
import { AdminAiModelsRepo } from "./admin-ai-models.repo.js";
import { AdminAiModelsService } from "./admin-ai-models.service.js";
import { AdminAiOverviewController } from "./admin-ai-overview.controller.js";
import { AdminAiOverviewRepo } from "./admin-ai-overview.repo.js";
import { AdminAiOverviewService } from "./admin-ai-overview.service.js";
import { AdminAiPlaygroundController } from "./admin-ai-playground.controller.js";
import { AdminAiPlaygroundRepo } from "./admin-ai-playground.repo.js";
import { AdminAiPlaygroundService } from "./admin-ai-playground.service.js";
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
import { AdminAiSkillsController } from "./admin-ai-skills.controller.js";
import { AdminAiSkillsRepo } from "./admin-ai-skills.repo.js";
import { AdminAiSkillsService } from "./admin-ai-skills.service.js";
import { AdminAiUsageController } from "./admin-ai-usage.controller.js";
import { AdminAiUsageRepo } from "./admin-ai-usage.repo.js";
import { AdminAiUsageService } from "./admin-ai-usage.service.js";
import { AiGatewayFactory } from "./ai-gateway.factory.js";

/** AI control plane under `/admin/ai`: providers and keys, models and prices, routes, settings, overview, playground, usage, skills (Task 2.4). */
@Module({
  imports: [AiRuntimeModule, AuthModule, FilesModule],
  controllers: [
    AdminAiProvidersController,
    AdminAiModelsController,
    AdminAiRoutesController,
    AdminAiSettingsController,
    AdminAiOverviewController,
    AdminAiPlaygroundController,
    AdminAiUsageController,
    AdminAiSkillsController,
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
    AdminAiOverviewRepo,
    AdminAiOverviewService,
    AdminAiUsageRepo,
    AdminAiUsageService,
    AdminAiSkillsRepo,
    AdminAiSkillsService,
    AdminAiPlaygroundRepo,
    ChatImages,
    AdminAiPlaygroundService,
  ],
})
export class AdminAiModule {}
