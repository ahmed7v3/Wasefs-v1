import { Inject, Injectable } from "@nestjs/common";
import { WA_AGENT_IN_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentInboundSchema } from "@wasfa/shared/schemas/wa-agent";
import { PinoLogger } from "nestjs-pino";

import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { StreamConsumer } from "./stream-consumer.js";
import { TurnQueue } from "./turn/turn.queue.js";
import { TurnRepo } from "./turn/turn.repo.js";
import { WaAgentStateService } from "./wa-agent-state.service.js";
import { WaAgentRepo } from "./wa-agent.repo.js";
import { WA_AGENT_TURN_HANDLER, type WaAgentTurnHandler } from "./wa-agent.tokens.js";

import type { ApiEnv } from "../config/env.js";

const GROUP = "wa-agent";
const MINUTE_MS = 60_000;

/**
 * Reads `wa:agent:in` (written by the WhatsApp bridge), stores the transcript and hands each customer
 * message to the agent. The bridge only sends while the agent is on; a stale entry that arrives after
 * the switch went off is still stored but not answered. Logs ids and kinds, never numbers or texts.
 */
@Injectable()
export class WaAgentInboundConsumer extends StreamConsumer {
  constructor(
    @Inject(API_ENV) env: ApiEnv,
    logger: PinoLogger,
    private readonly repo: WaAgentRepo,
    private readonly state: WaAgentStateService,
    private readonly settings: SettingsService,
    @Inject(WA_AGENT_TURN_HANDLER) private readonly turns: WaAgentTurnHandler,
    private readonly turnQueue: TurnQueue,
    private readonly turnRows: TurnRepo,
  ) {
    super(env, logger, WA_AGENT_IN_STREAM, GROUP, {
      isV2: async () => (await settings.get("waAgent")).runtime.v2,
    });
    this.logger.setContext("WaAgentInbound");
  }

  async process(payload: unknown): Promise<void> {
    const parsed = waAgentInboundSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn("Malformed agent inbound entry dropped");
      return;
    }
    const entry = parsed.data;
    const config = await this.settings.get("waAgent");
    const pauseUntil = new Date(Date.now() + config.takeoverPauseMinutes * MINUTE_MS);
    const { conversation, inserted } = await this.repo.ingest(entry, pauseUntil);
    if (!inserted) {
      // A redelivered entry after a crash: its row may still wait for an answer (v2 only).
      if (
        config.runtime.v2 &&
        entry.direction === "in" &&
        config.enabled &&
        !WaAgentStateService.isHeld(conversation) &&
        (await this.turnRows.hasUnanswered(conversation.id))
      ) {
        await this.enqueueTurn(conversation.id);
      }
      return;
    }
    // The row is the truth; the keys the bridge checks follow it (and a block is kept alive).
    await this.state.mirror(conversation);
    if (entry.direction === "owner") {
      this.logger.info({ conversationId: conversation.id }, "Owner took over; agent paused");
      return;
    }
    if (!config.enabled || WaAgentStateService.isHeld(conversation)) return;
    if (config.runtime.v2) {
      await this.enqueueTurn(conversation.id);
      return;
    }
    try {
      await this.turns.onInbound(conversation.id);
    } catch (error) {
      this.logger.error(
        { conversationId: conversation.id, reason: (error as Error).name },
        "Agent turn failed",
      );
    }
  }

  /** v2: the message is stored; a debounced job answers it. A failure is logged, the stream moves on. */
  private async enqueueTurn(conversationId: string): Promise<void> {
    try {
      await this.turnQueue.enqueue(conversationId);
    } catch (error) {
      // The row stays unanswered: the next message or the audit finds it.
      this.logger.error({ conversationId, reason: (error as Error).name }, "Agent turn not queued");
    }
  }
}
