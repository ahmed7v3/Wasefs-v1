import { Module } from "@nestjs/common";

import { AiRuntimeModule } from "../ai-runtime/ai-runtime.module.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { FilesModule } from "../files/files.module.js";
import { MediaModule } from "../media/media.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";

import { AgentAccountService } from "./agent/account-facts.service.js";
import { WaAgentHandoffService } from "./agent/handoff.service.js";
import { WaAgentToolDeps } from "./agent/tool-deps.js";
import { WaAgentTurnService } from "./agent/wa-agent-turn.service.js";
import { WaAgentInboundConsumer } from "./wa-agent-inbound.consumer.js";
import { WaAgentSentConsumer } from "./wa-agent-sent.consumer.js";
import { WaAgentStateService } from "./wa-agent-state.service.js";
import { WaAgentRepo } from "./wa-agent.repo.js";
import { WA_AGENT_TURN_HANDLER } from "./wa-agent.tokens.js";
import { WaOutboundService } from "./wa-outbound.service.js";

/**
 * The WhatsApp AI agent's transport and data layer (docs/WA-AGENT.md work package A): transcript
 * storage from the bridge, the outbound queue to it, pause / block, and the agent itself (work package
 * B, `WaAgentTurnService`, bound to `WA_AGENT_TURN_HANDLER`). Always started, like the OTP consumer:
 * the agent's own switch (`waAgent.enabled`) decides whether anything is answered.
 */
@Module({
  imports: [
    AiRuntimeModule,
    AlertsModule,
    CatalogModule,
    CreditsModule,
    FilesModule,
    MediaModule,
    PlansModule,
    SubscriptionsModule,
  ],
  providers: [
    WaAgentRepo,
    WaAgentStateService,
    WaOutboundService,
    AgentAccountService,
    WaAgentHandoffService,
    WaAgentToolDeps,
    WaAgentTurnService,
    WaAgentInboundConsumer,
    WaAgentSentConsumer,
    { provide: WA_AGENT_TURN_HANDLER, useExisting: WaAgentTurnService },
  ],
  exports: [WaOutboundService, WaAgentStateService, WA_AGENT_TURN_HANDLER],
})
export class WaAgentModule {}
