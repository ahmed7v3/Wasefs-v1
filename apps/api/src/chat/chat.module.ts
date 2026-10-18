import { Module } from "@nestjs/common";
import { CHAT_HEARTBEAT_MS } from "@wasfa/shared/schemas/chat";

import { AiRuntimeModule } from "../ai-runtime/ai-runtime.module.js";
import { ErrorReporter } from "../common/errors.js";
import { CreditsModule } from "../credits/credits.module.js";
import { FilesModule } from "../files/files.module.js";
import { OrgWalletModule } from "../orgs/wallet/wallet.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { QuotaModule } from "../quota/quota.module.js";
import { SettingsModule } from "../settings/settings.module.js";

import { ChatBackground } from "./chat-background.js";
import { ChatImages } from "./chat-images.js";
import { ChatSkillGate } from "./chat-skills.js";
import { ChatTurnService } from "./chat-turn.service.js";
import { CHAT_HEARTBEAT_MS_TOKEN, ChatController } from "./chat.controller.js";
import { ChatRepo } from "./chat.repo.js";
import { ChatService } from "./chat.service.js";

/** The `/ai` assistant: chats, history and the streamed answer (Task 2.11). */
@Module({
  imports: [
    AiRuntimeModule,
    CreditsModule,
    FilesModule,
    OrgWalletModule,
    PlansModule,
    QuotaModule,
    SettingsModule,
  ],
  controllers: [ChatController],
  providers: [
    ErrorReporter,
    ChatRepo,
    ChatService,
    ChatImages,
    ChatSkillGate,
    ChatBackground,
    ChatTurnService,
    { provide: CHAT_HEARTBEAT_MS_TOKEN, useValue: CHAT_HEARTBEAT_MS },
  ],
  exports: [ChatBackground],
})
export class ChatModule {}
