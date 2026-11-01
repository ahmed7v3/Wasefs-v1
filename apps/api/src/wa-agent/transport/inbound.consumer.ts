import { Inject, Injectable } from "@nestjs/common";
import { WA_AGENT_IN_STREAM } from "@wasfa/shared/schemas/phone";
import { waAgentInboundSchema } from "@wasfa/shared/schemas/wa-agent";
import { PinoLogger } from "nestjs-pino";

import { API_ENV } from "../../config/config.module.js";
import { SettingsService } from "../../settings/settings.service.js";
import { intentOf, stateOf } from "../commands/command-intent.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";
import { SessionService } from "../conversation/session.service.js";
import { WaAgentStateService } from "../conversation/state.service.js";
import { OutboxDeliverer } from "../outbox/deliverer.js";
import { TurnQueue } from "../turn/turn.queue.js";
import { TurnRepo } from "../turn/turn.repo.js";
import { WA_AGENT_TURN_HANDLER, type WaAgentTurnHandler } from "../wa-agent.tokens.js";

import { StreamConsumer } from "./stream-consumer.js";

import type { ApiEnv } from "../../config/env.js";
import type { WaAgentInbound } from "@wasfa/shared/schemas/wa-agent";
import type { WaAgentSettings } from "@wasfa/shared/settings";

const GROUP = "wa-agent";
const MINUTE_MS = 60_000;
/**
 * How much longer than `replyDelaySeconds` the oldest unanswered message may wait before the debounce stops
 * extending: enough for the jitter (25 %) and a busy worker, small enough that a customer who keeps typing
 * still gets a reply (no starvation).
 */
const DEBOUNCE_CAP_MARGIN_MS = 20_000;
/** A command is at most four short words; longer texts are not worth a state lookup. */
const MAX_COMMAND_CHARS = 80;

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
    private readonly outbox: OutboxDeliverer,
    private readonly sessions: SessionService,
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
    // v2 only: sessions are assigned in the transaction that stores the row; v1 writes none of it.
    const sessionConfig = config.runtime.v2
      ? { idleHours: config.sessions.idleHours, maxPages: (await this.settings.get("rx")).maxPages }
      : null;
    const { conversation, inserted } = await this.repo.ingest(
      entry,
      pauseUntil,
      sessionConfig === null
        ? undefined
        : (tx, conv, row) => this.sessions.assignInTx(tx, conv, row, new Date(), sessionConfig),
    );
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
    if (config.runtime.v2) {
      // Results held for the closed 24 h window are delivered first.
      await this.outbox.onCustomerMessage(conversation.id).catch((error: unknown) => {
        this.logger.warn(
          { conversationId: conversation.id, reason: (error as Error).name },
          "Held outbox items not released",
        );
      });
    }
    if (!config.enabled || WaAgentStateService.isHeld(conversation)) return;
    if (config.runtime.v2) {
      // A command is answered at once; the runner matches again under the lock (matching is pure and cheap).
      const immediate = await this.isCommand(conversation.id, entry, config).catch(() => false);
      await this.enqueueTurn(conversation.id, immediate);
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

  /** True when the new row is a command (a text, or an image/PDF caption) under the chat's session state. */
  private async isCommand(
    conversationId: string,
    entry: WaAgentInbound,
    config: WaAgentSettings,
  ): Promise<boolean> {
    const text = entry.text;
    if (!config.commands.enabled || entry.direction !== "in") return false;
    if (text === undefined || text.length === 0 || text.length > MAX_COMMAND_CHARS) return false;
    const session = await this.sessions.context(conversationId);
    const state = session === null ? {} : await this.sessions.state(session.id);
    const intent = intentOf(
      { kind: entry.kind, text, mediaKey: entry.media?.key },
      stateOf(state, new Date()),
      config.commands.extraAliases,
    );
    return intent.type === "command";
  }

  /**
   * v2: the message is stored; a debounced job answers it. A failure is logged, the stream moves on.
   * The debounce has a cap: a customer who keeps typing would push the job back for ever and never get a
   * reply, so once the oldest unanswered message has waited past the reply delay plus a margin, the job
   * is queued without extending.
   */
  private async enqueueTurn(conversationId: string, immediate = false): Promise<void> {
    try {
      if (immediate) {
        await this.turnQueue.enqueue(conversationId, { delayMs: 0 });
        return;
      }
      const config = await this.settings.get("waAgent");
      const oldest = await this.turnRows.oldestUnansweredAt(conversationId);
      const waitedMs = oldest === null ? 0 : Date.now() - oldest.getTime();
      const capped = waitedMs > config.replyDelaySeconds * 1_000 + DEBOUNCE_CAP_MARGIN_MS;
      await this.turnQueue.enqueue(conversationId, capped ? { extend: false } : {});
    } catch (error) {
      // The row stays unanswered: the next message or the audit finds it.
      this.logger.error({ conversationId, reason: (error as Error).name }, "Agent turn not queued");
    }
  }
}
