import { Module } from "@nestjs/common";

import { AiRuntimeModule } from "../ai-runtime/ai-runtime.module.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { ErrorReporter } from "../common/errors.js";
import { REDIS } from "../common/redis.js";
import { CreditsModule } from "../credits/credits.module.js";
import { FilesModule } from "../files/files.module.js";
import { MediaModule } from "../media/media.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { RxModule } from "../rx/rx.module.js";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";

import { AgentAccountService } from "./agent/account-facts.service.js";
import { AgentSignupService } from "./agent/agent-signup.service.js";
import { WaAgentHandoffService } from "./agent/handoff.service.js";
import { WaAgentToolDeps } from "./agent/tool-deps.js";
import { WaAgentTurnService } from "./agent/wa-agent-turn.service.js";
import { WaAgentCommerceRepo } from "./commerce/agent-commerce.repo.js";
import { AgentDiscountService } from "./commerce/agent-discount.service.js";
import { AgentMedicalService } from "./commerce/agent-medical.service.js";
import { AgentRxService } from "./commerce/agent-rx.service.js";
import { AgentSubscriptionService } from "./commerce/agent-subscription.service.js";
import { WaAgentEventsConsumer } from "./commerce/wa-agent-events.consumer.js";
import { AgentDocumentService } from "./documents/agent-document.service.js";
import { WaDocumentQueue } from "./documents/wa-document-queue.js";
import { DlqService } from "./transport/dlq.service.js";
import { FailureActions } from "./turn/failure-actions.js";
import { ConversationLock } from "./turn/lock.js";
import { TurnRunner } from "./turn/turn-runner.js";
import { TurnQueue } from "./turn/turn.queue.js";
import { TurnRepo } from "./turn/turn.repo.js";
import { TurnStore } from "./turn/turn.store.js";
import { TurnWorker } from "./turn/turn.worker.js";
import { ElevenLabsClient } from "./voice/elevenlabs.client.js";
import { VoiceKeyService } from "./voice/voice-key.service.js";
import { WaAgentVoiceService } from "./voice/voice.service.js";
import { WaAgentInboundConsumer } from "./wa-agent-inbound.consumer.js";
import { WaAgentSentConsumer } from "./wa-agent-sent.consumer.js";
import { WaAgentStateService } from "./wa-agent-state.service.js";
import { WaAgentRepo } from "./wa-agent.repo.js";
import { WA_AGENT_ROUND, WA_AGENT_TURN_HANDLER } from "./wa-agent.tokens.js";
import { WaOutboundService } from "./wa-outbound.service.js";

import type { Redis } from "ioredis";

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
    AuthModule,
    BillingModule,
    CatalogModule,
    ChatModule,
    CreditsModule,
    FilesModule,
    MediaModule,
    PaymentsModule,
    PlansModule,
    RxModule,
    SubscriptionsModule,
  ],
  providers: [
    WaAgentRepo,
    WaAgentStateService,
    WaOutboundService,
    AgentAccountService,
    AgentSignupService,
    WaAgentHandoffService,
    WaAgentCommerceRepo,
    AgentDiscountService,
    AgentSubscriptionService,
    AgentRxService,
    AgentMedicalService,
    WaDocumentQueue,
    AgentDocumentService,
    WaAgentToolDeps,
    VoiceKeyService,
    ElevenLabsClient,
    WaAgentVoiceService,
    WaAgentTurnService,
    WaAgentInboundConsumer,
    WaAgentSentConsumer,
    WaAgentEventsConsumer,
    DlqService,
    { provide: WA_AGENT_TURN_HANDLER, useExisting: WaAgentTurnService },
    // The v2 turn engine (behind `waAgent.runtime.v2`): queue, fenced lock, turn store, runner, worker.
    { provide: WA_AGENT_ROUND, useExisting: WaAgentTurnService },
    {
      provide: ConversationLock,
      inject: [REDIS],
      useFactory: (redis: Redis) => new ConversationLock(redis),
    },
    TurnRepo,
    TurnStore,
    TurnQueue,
    ErrorReporter,
    FailureActions,
    TurnRunner,
    TurnWorker,
  ],
  exports: [
    WaOutboundService,
    WaAgentStateService,
    WaAgentVoiceService,
    VoiceKeyService,
    DlqService,
    WA_AGENT_TURN_HANDLER,
  ],
})
export class WaAgentModule {}
