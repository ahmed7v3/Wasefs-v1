import { Module } from "@nestjs/common";

import { SettingsModule } from "../settings/settings.module.js";

import { AiRuntimeService } from "./ai-runtime.service.js";

/** The AI router wired to the API's database, Redis, settings and keys. Features import this module. */
@Module({
  imports: [SettingsModule],
  providers: [AiRuntimeService],
  exports: [AiRuntimeService],
})
export class AiRuntimeModule {}
