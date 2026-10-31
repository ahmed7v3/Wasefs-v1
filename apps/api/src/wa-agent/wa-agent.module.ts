import { Module } from "@nestjs/common";

import { AiRuntimeModule } from "../ai-runtime/ai-runtime.module.js";
import { AlertsModule } from "../alerts/alerts.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { ChatModule } from "../chat/chat.module.js";
import { ErrorReporter } from "../common/errors.js";
import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { FilesModule } from "../files/files.module.js";
import { MediaModule } from "../media/media.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { RxModule } from "../rx/rx.module.js";
import { RxService } from "../rx/rx.service.js";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module.js";

import { AgentAccountService } from "./agent/account-facts.service.js";
import { AgentSignupService } from "./agent/agent-signup.service.js";
import { WaAgentHandoffService } from "./agent/handoff.service.js";
import { MediaInputService } from "./agent/media-input.js";
import { AgentRoundService } from "./agent/round.service.js";
import { SummaryService } from "./agent/summary.service.js";
import { WaAgentToolDeps } from "./agent/tool-deps.js";
import { ToolEffectsRepo } from "./agent/tools/tool-effects.repo.js";
import { WaAgentCommerceRepo } from "./commerce/agent-commerce.repo.js";
import { AgentDiscountService } from "./commerce/agent-discount.service.js";
import { AgentMedicalService } from "./commerce/agent-medical.service.js";
import { AgentSubscriptionService } from "./commerce/agent-subscription.service.js";
import { WaAgentEventsConsumer } from "./commerce/wa-agent-events.consumer.js";
import { WaAgentRepo } from "./conversation/conversation.repo.js";
import { WaAgentStateService } from "./conversation/state.service.js";
import { AgentDocumentService } from "./documents/agent-document.service.js";
import { WaDocumentQueue } from "./documents/wa-document-queue.js";
import { OutboxDeliverer } from "./outbox/deliverer.js";
import { EventPartsBuilder } from "./outbox/outbox-parts.js";
import { RxReconciler } from "./outbox/rx-reconciler.js";
import { RxReconcilerRepo } from "./outbox/rx-reconciler.repo.js";
import { WaOutboxRepo } from "./outbox/wa-outbox.repo.js";
import { AgentRxRepo } from "./rx/agent-rx.repo.js";
import { AgentRxService } from "./rx/agent-rx.service.js";
import { RxStartService } from "./rx/rx-start.service.js";
import { DlqService } from "./transport/dlq.service.js";
import { WaAgentInboundConsumer } from "./transport/inbound.consumer.js";
import { WaOutboundService } from "./transport/outbound.service.js";
import { WaAgentSentConsumer } from "./transport/sent.consumer.js";
import { FailureActions } from "./turn/failure-actions.js";
import { ConversationLock } from "./turn/lock.js";
import { TurnRunner } from "./turn/turn-runner.js";
import { TurnQueue } from "./turn/turn.queue.js";
import { TurnRepo } from "./turn/turn.repo.js";
import { TurnStore } from "./turn/turn.store.js";
import { TurnWorker } from "./turn/turn.worker.js";
import { WaAgentTurnService } from "./turn/v1-turn.service.js";
import { ElevenLabsClient } from "./voice/elevenlabs.client.js";
import { VoiceKeyService } from "./voice/voice-key.service.js";
import { WaAgentVoiceService } from "./voice/voice.service.js";
import {
  WA_AGENT_ROUND,
  WA_AGENT_TURN_HANDLER,
  WA_OUTBOX_SWEEPS,
  type OutboxSweep,
} from "./wa-agent.tokens.js";

import type { ApiEnv } from "../config/env.js";
import type { Redis } from "ioredis";

const RX_RECONCILE_EVERY_MS = 30_000;

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
    AgentRxRepo,
    RxStartService,
    AgentRxService,
    AgentMedicalService,
    WaDocumentQueue,
    AgentDocumentService,
    ToolEffectsRepo,
    WaAgentToolDeps,
    RxReconcilerRepo,
    RxReconciler,
    VoiceKeyService,
    ElevenLabsClient,
    WaAgentVoiceService,
    MediaInputService,
    SummaryService,
    AgentRoundService,
    WaAgentTurnService,
    WaAgentInboundConsumer,
    WaAgentSentConsumer,
    WaAgentEventsConsumer,
    DlqService,
    { provide: WA_AGENT_TURN_HANDLER, useExisting: WaAgentTurnService },
    // The v2 turn engine (behind `waAgent.runtime.v2`): queue, fenced lock, turn store, runner, worker.
    { provide: WA_AGENT_ROUND, useExisting: AgentRoundService },
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
    // Results of paid work and worker events, delivered from `wa_outbox` (behind `waAgent.runtime.v2`).
    WaOutboxRepo,
    {
      // The deliverer ticks every 5 s; the rx reconciler runs on every sixth tick (30 s).
      provide: WA_OUTBOX_SWEEPS,
      inject: [RxReconciler],
      useFactory: (reconciler: RxReconciler): OutboxSweep[] => {
        let last = 0;
        return [
          async () => {
            if (Date.now() - last < RX_RECONCILE_EVERY_MS) return;
            last = Date.now();
            await reconciler.sweep();
          },
        ];
      },
    },
    {
      provide: EventPartsBuilder,
      inject: [API_ENV, WaAgentCommerceRepo, RxService],
      useFactory: (env: ApiEnv, commerce: WaAgentCommerceRepo, rx: RxService) =>
        new EventPartsBuilder(env.WEB_ORIGIN[0] ?? "", commerce, rx),
    },
    OutboxDeliverer,
  ],
  exports: [
    WaOutboundService,
    WaAgentStateService,
    WaAgentVoiceService,
    VoiceKeyService,
    DlqService,
    RxReconciler,
    WA_AGENT_TURN_HANDLER,
    OutboxDeliverer,
    WA_OUTBOX_SWEEPS,
  ],
})
export class WaAgentModule {}
