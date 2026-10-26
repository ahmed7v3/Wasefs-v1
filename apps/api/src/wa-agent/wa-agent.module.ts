import { Module } from "@nestjs/common";

import { WaAgentInboundConsumer } from "./wa-agent-inbound.consumer.js";
import { WaAgentSentConsumer } from "./wa-agent-sent.consumer.js";
import { WaAgentStateService } from "./wa-agent-state.service.js";
import { WaAgentRepo } from "./wa-agent.repo.js";
import { NoopTurnHandler, WA_AGENT_TURN_HANDLER } from "./wa-agent.tokens.js";
import { WaOutboundService } from "./wa-outbound.service.js";

/**
 * The WhatsApp AI agent's transport and data layer (docs/WA-AGENT.md work package A): transcript
 * storage from the bridge, the outbound queue to it, pause / block. The agent itself (work package B)
 * replaces the `WA_AGENT_TURN_HANDLER` provider. Always started, like the OTP consumer: the agent's
 * own switch (`waAgent.enabled`) decides whether anything is answered.
 */
@Module({
  providers: [
    WaAgentRepo,
    WaAgentStateService,
    WaOutboundService,
    WaAgentInboundConsumer,
    WaAgentSentConsumer,
    { provide: WA_AGENT_TURN_HANDLER, useClass: NoopTurnHandler },
  ],
  exports: [WaOutboundService, WaAgentStateService, WA_AGENT_TURN_HANDLER],
})
export class WaAgentModule {}
