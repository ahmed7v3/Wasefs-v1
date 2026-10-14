import { Module } from "@nestjs/common";

import { AiRuntimeModule } from "../ai-runtime/ai-runtime.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { DrugsModule } from "../drugs/drugs.module.js";
import { FilesModule } from "../files/files.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { QuotaModule } from "../quota/quota.module.js";
import { SettingsModule } from "../settings/settings.module.js";

import { RxEventHub } from "./rx-event-hub.js";
import { RxQueue } from "./rx-queue.js";
import { RxController } from "./rx.controller.js";
import { RxRepo } from "./rx.repo.js";
import { RxService } from "./rx.service.js";

/** Prescription analysis: `POST /rx`, the result, its live progress, history and corrections (Task 2.8). */
@Module({
  imports: [
    AiRuntimeModule,
    CreditsModule,
    DrugsModule,
    FilesModule,
    PlansModule,
    QuotaModule,
    SettingsModule,
  ],
  controllers: [RxController],
  providers: [RxRepo, RxQueue, RxEventHub, RxService],
})
export class RxModule {}
