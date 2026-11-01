import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { newId } from "@wasfa/shared/ids";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentHandoffService, handoffFlagKey } from "../agent/handoff.service.js";
import {
  DAY_SECONDS,
  HISTORY_LIMIT,
  cannedText,
  pendingMessages,
  utcDay,
  type TurnTiming,
} from "../agent/round-helpers.js";
import { AgentRoundService } from "../agent/round.service.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";
import { WaAgentStateService } from "../conversation/state.service.js";
import { WaOutboundService } from "../transport/outbound.service.js";
import { type WaAgentTurnHandler } from "../wa-agent.tokens.js";

import { RoundRefused, type RoundOutcome } from "./agent-round.js";
import { singleRetry } from "./retry-ladder.js";

import type { WaConversation } from "@wasfa/db";
import type { WaAgentSettings } from "@wasfa/shared/settings";

/**
 * One model call's own limit. The old single 90 s budget covered the whole tool loop, so a turn with a
 * few slow steps timed out and the customer got the "busy" line and a handoff for a healthy model.
 */
export const STEP_TIMEOUT_MS = 45_000;
/** The whole turn, across all its steps. Must stay below `LOCK_MS`: the lock must outlive the turn. */
export const TURN_TIMEOUT_MS = 150_000;
/** Pause before the one retry of a provider error that came before any tool ran. */
export const PROVIDER_RETRY_DELAY_MS = 1_500;

/** A turn holds the chat's lock this long at most; a crashed holder frees it by expiry. */
/** Per-conversation turn lock; longer than the whole turn (`TURN_TIMEOUT_MS`), so two turns never overlap. */
export const LOCK_MS = 180_000;
/** Extra turns a holder runs for messages that arrived while it was busy, per call. */
const MAX_EXTRA_TURNS = 3;

/** Why the owner is asked to take over when the agent cannot answer (shown in the admin alert). */
/**
 * Why the agent could not answer. The customer always sees the same polite line; the cause goes to the
 * log and to the owner's handoff note, so an incident can be told apart from a real capacity limit.
 */
export type BusyCause =
  /** The agent's own daily spend reached `spendCapUsdMicros`. */
  | "spend_cap"
  /** The AI kill switch, the platform's daily cap, or the availability check itself failed. */
  | "ai_unavailable"
  /** A model call failed or timed out during the turn (see `detail` in the log). */
  | "model_failed";

const BUSY_OWNER_REASON: Record<BusyCause, string> = {
  spend_cap: "سقف إنفاق الوكيل اليومي وصل حده",
  ai_unavailable: "الذكاء الاصطناعي متوقف أو غير متاح الآن",
  model_failed: "تعذّر على الوكيل الرد الآلي (فشل أو مهلة في النموذج)",
};

const lockKey = (conversationId: string) => `wa:agent:turn:${conversationId}`;
const againKey = (conversationId: string) => `wa:agent:again:${conversationId}`;
const unavailableKey = (conversationId: string) => `wa:agent:unavailable:${conversationId}`;
const busyKey = (conversationId: string, at: Date) =>
  `wa:agent:busy:${conversationId}:${utcDay(at)}`;

// Deletes the lock only while it is still ours (it may have expired and been taken by another turn).
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

/**
 * The WhatsApp agent, v1 entry: answers a customer's messages in the owner's voice (docs/WA-AGENT.md).
 * One turn at a time per conversation (a Redis lock; messages that arrive meanwhile set a flag and get
 * one more turn), identity and account standing decided from the database, the round itself run by
 * `AgentRoundService`. Logs ids, counts and causes: never phone numbers, message texts, tool arguments
 * or results.
 */
@Injectable()
export class WaAgentTurnService implements WaAgentTurnHandler, OnApplicationShutdown {
  constructor(
    private readonly repo: WaAgentRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly outbound: WaOutboundService,
    private readonly handoff: WaAgentHandoffService,
    private readonly round: AgentRoundService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentTurn");
  }

  /** The round's clock (shared state); tests replace its waits. */
  get timing(): TurnTiming {
    return this.round.timing;
  }

  /** Replaced by tests: decides the "sometimes" voice replies. */
  get random(): () => number {
    return this.round.random;
  }

  set random(value: () => number) {
    this.round.random = value;
  }

  /** Resolves when the follow-up work started so far (summaries) has finished. */
  async drain(): Promise<void> {
    await this.round.drain();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  async onInbound(conversationId: string): Promise<void> {
    const token = newId();
    const got = await this.redis.set(lockKey(conversationId), token, "PX", LOCK_MS, "NX");
    if (got !== "OK") {
      // A turn is running: it will look again before it lets go.
      await this.redis.set(againKey(conversationId), "1", "PX", LOCK_MS);
      return;
    }
    try {
      for (let round = 0; round <= MAX_EXTRA_TURNS; round++) {
        await this.waitForQuiet(conversationId);
        await this.runTurn(conversationId);
        if ((await this.redis.getdel(againKey(conversationId))) === null) break;
      }
    } finally {
      await this.redis.eval(RELEASE_LOCK, 1, lockKey(conversationId), token);
    }
    // A message that slipped in between the last look and the release still gets its answer.
    if ((await this.redis.getdel(againKey(conversationId))) !== null) {
      await this.onInbound(conversationId);
    }
  }

  /** Waits until the customer has been quiet for `quietMs` (a burst is one question), at most `maxQuietWaitMs`. */
  private async waitForQuiet(conversationId: string): Promise<void> {
    const { quietMs, maxQuietWaitMs, sleep, now } = this.timing;
    const deadline = now() + maxQuietWaitMs;
    for (;;) {
      const conversation = await this.repo.find(conversationId);
      const lastIn = conversation?.lastInboundAt?.getTime();
      if (lastIn === undefined) return;
      const wait = Math.min(lastIn + quietMs, deadline) - now();
      if (wait <= 0) return;
      await sleep(wait);
    }
  }

  private async runTurn(conversationId: string): Promise<void> {
    // Everything is read again: the switch, the pause and the settings may have changed while waiting.
    const config = await this.settings.get("waAgent");
    if (!config.enabled) return;
    const conversation = await this.repo.find(conversationId);
    if (!conversation || WaAgentStateService.isHeld(conversation)) return;
    if ((await this.redis.exists(handoffFlagKey(conversationId))) === 1) return;

    const rows = await this.repo.recentMessages(conversationId, HISTORY_LIMIT);
    const now = new Date(this.timing.now());
    const pending = pendingMessages(rows, now.getTime());
    if (pending.length === 0) return;

    let outcome: RoundOutcome | null;
    try {
      outcome = await this.round.composeReply({
        conversation,
        pending,
        rows,
        config,
        now,
        limits: { stepMs: STEP_TIMEOUT_MS, turnMs: TURN_TIMEOUT_MS },
        stepRetry: singleRetry((ms) => this.timing.sleep(ms), PROVIDER_RETRY_DELAY_MS),
        // Taken: a message that arrives from here on is not part of this turn and gets the next one.
        onTaken: (messageIds, requestId) => this.repo.setMeta(messageIds, { turn: requestId }),
      });
    } catch (error) {
      if (!(error instanceof RoundRefused)) throw error;
      if (error.refusal.kind === "account_unavailable") {
        await this.accountUnavailable(conversation, config);
      } else {
        await this.busy(conversation, config, now, error.refusal.cause, error.refusal.detail);
      }
      return;
    }
    if (outcome === null) return;

    let messageIds: string[] = [];
    if (outcome.parts.length > 0) {
      try {
        messageIds = await this.outbound.enqueue(conversationId, outcome.parts);
      } catch (error) {
        // Paused, blocked or switched off while the model worked: the reply is not wanted any more.
        this.logger.info(
          { conversationId, reason: error instanceof Error ? error.name : "unknown" },
          "Agent reply not queued",
        );
        await this.round.discard(outcome);
        return;
      }
    }
    await this.round.afterReply(conversationId, messageIds, outcome);
  }

  /** A suspended or deleted account gets one polite line per day, and nothing else. */
  private async accountUnavailable(
    conversation: WaConversation,
    config: WaAgentSettings,
  ): Promise<void> {
    const first = await this.redis.set(
      unavailableKey(conversation.id),
      "1",
      "EX",
      DAY_SECONDS,
      "NX",
    );
    if (first !== "OK") return;
    await this.say(conversation.id, cannedText("whatsapp.agent.accountUnavailable", config));
  }

  /**
   * The agent cannot answer (daily spend cap, AI off, provider error): one line per chat per day, then
   * the owner is asked to take over. Nothing about the failure reaches the customer.
   */
  private async busy(
    conversation: WaConversation,
    config: WaAgentSettings,
    now: Date,
    cause: BusyCause,
    detail: Record<string, string | number | undefined> = {},
  ): Promise<void> {
    const first = await this.redis.set(
      busyKey(conversation.id, now),
      "1",
      "EX",
      2 * DAY_SECONDS,
      "NX",
    );
    if (first !== "OK") return;
    // Logged before anything is sent, so every busy line in the customer's chat has a reason in the logs.
    this.logger.warn({ conversationId: conversation.id, cause, ...detail }, "Agent cannot answer");
    const messageIds = await this.say(conversation.id, cannedText("whatsapp.agent.busy", config));
    await this.handoff.raise(conversation.id, BUSY_OWNER_REASON[cause]);
    this.handoff.pauseWhenDelivered(conversation.id, messageIds);
  }

  /** Queues one text; a refusal (paused, off) is logged, never thrown into the stream consumer. */
  private async say(conversationId: string, text: string): Promise<string[]> {
    try {
      return await this.outbound.enqueue(conversationId, [{ kind: "text", text }]);
    } catch (error) {
      this.logger.info(
        { conversationId, reason: error instanceof Error ? error.name : "unknown" },
        "Agent line not queued",
      );
      return [];
    }
  }
}
