import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PinoLogger } from "nestjs-pino";

import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentRepo } from "../wa-agent.repo.js";
import { WA_AGENT_ROUND } from "../wa-agent.tokens.js";
import { WaOutboundService } from "../wa-outbound.service.js";

import { ConversationLock, StaleFenceError } from "./lock.js";
import { TurnQueue, type TurnEnqueuer } from "./turn.queue.js";
import { TurnStore, type ActiveTurn } from "./turn.store.js";

import type { AgentRound, RoundOutcome } from "./agent-round.js";

/** How a run ended: `busy` = another worker holds the conversation, `stale` = our lock was taken over. */
export type RunResult = "idle" | "answered" | "busy" | "stale";

/** What the runner needs from the rest of the module; the real services fit, tests pass fakes. */
export interface TurnRunnerPorts {
  lock: Pick<ConversationLock, "acquire">;
  store: Pick<
    TurnStore,
    "bumpFence" | "unanswered" | "hasUnanswered" | "begin" | "endOf" | "endQuietly"
  >;
  conversations: Pick<WaAgentRepo, "find">;
  settings: Pick<SettingsService, "get">;
  round: AgentRound;
  outbound: Pick<WaOutboundService, "enqueueFenced">;
  queue: TurnEnqueuer;
  logger: Pick<PinoLogger, "warn" | "info">;
}

/**
 * One v2 job for one conversation (docs/WA-AGENT-RUNTIME.md §4.3, §17): take the conversation lock and its
 * fence, then drain: each round answers every customer message that is still unanswered, until none is left
 * or `runtime.maxRounds` rounds ran. Messages that arrive after the last look are caught by the re-check
 * after the lock is released, which queues another job.
 */
@Injectable()
export class TurnRunner {
  private readonly ports: TurnRunnerPorts;

  constructor(
    lock: ConversationLock,
    store: TurnStore,
    conversations: WaAgentRepo,
    settings: SettingsService,
    @Inject(WA_AGENT_ROUND) round: AgentRound,
    outbound: WaOutboundService,
    @Inject(TurnQueue) queue: TurnEnqueuer,
    logger: PinoLogger,
  ) {
    logger.setContext("WaAgentTurnRunner");
    this.ports = { lock, store, conversations, settings, round, outbound, queue, logger };
  }

  /** Ports given directly: how tests build a runner. */
  static of(ports: TurnRunnerPorts): TurnRunner {
    const runner = Object.create(TurnRunner.prototype) as { ports: TurnRunnerPorts };
    runner.ports = ports;
    return runner as unknown as TurnRunner;
  }

  async run(conversationId: string): Promise<RunResult> {
    const { lock, store, queue, logger } = this.ports;
    const handle = await lock.acquire(conversationId);
    if (handle === null) {
      // A turn is running: it looks again before it lets go, and this job comes back after it anyway.
      await queue.enqueue(conversationId);
      return "busy";
    }
    let result: RunResult;
    try {
      result = await this.drain(conversationId, handle.signal);
    } finally {
      await handle.release();
    }
    if (result === "stale") return result;
    // A message that arrived between the last look and the release still gets its turn.
    if (await store.hasUnanswered(conversationId)) {
      logger.info({ conversationId }, "Unanswered messages after the turn; queued again");
      await queue.enqueue(conversationId);
    }
    return result;
  }

  private async drain(conversationId: string, lockLost: AbortSignal): Promise<RunResult> {
    const { store, conversations, settings, round } = this.ports;
    const config = await settings.get("waAgent");
    const fence = await store.bumpFence(conversationId);
    let result: RunResult = "idle";
    for (let index = 0; index < config.runtime.maxRounds; index++) {
      lockLost.throwIfAborted();
      const unanswered = await store.unanswered(conversationId);
      if (unanswered.length === 0) break;
      const conversation = await conversations.find(conversationId);
      if (!conversation) break;
      const turn = await store.begin(conversationId, fence, unanswered);
      const signal = AbortSignal.any([lockLost, AbortSignal.timeout(config.runtime.turnTimeoutMs)]);

      // WP1.6: failure policy. For now a failed round closes nothing: the job fails and BullMQ retries it
      // (`runtime.jobAttempts`), the rows stay unlinked.
      const outcome = await round.compose(conversation, unanswered, signal);

      const ended = await this.finish(turn, outcome);
      if (ended === "stale") return "stale";
      result = "answered";
    }
    return result;
  }
  /** Writes the end of one round under the fence; "stale" when another worker owns the conversation now. */
  private async finish(turn: ActiveTurn, outcome: RoundOutcome): Promise<"done" | "stale"> {
    const { store, round, outbound, logger } = this.ports;
    const { conversationId } = turn;
    let messageIds: string[] = [];
    try {
      if (outcome.parts.length === 0) {
        await store.endQuietly(turn, outcome);
      } else {
        try {
          messageIds = await outbound.enqueueFenced(
            conversationId,
            outcome.parts,
            store.endOf(turn, outcome),
          );
        } catch (error) {
          if (!isRefusal(error)) throw error;
          // Paused, blocked or switched off while the model worked: the reply is not wanted any more.
          logger.info({ conversationId, turnId: turn.id }, "Agent reply not queued");
          await store.endQuietly(turn, outcome);
          await round.discard(outcome);
          return "done";
        }
      }
    } catch (error) {
      await round.discard(outcome);
      if (!(error instanceof StaleFenceError)) throw error;
      logger.warn(
        { conversationId, turnId: turn.id, fence: turn.fence },
        "Stale fence: turn dropped",
      );
      return "stale";
    }
    try {
      await round.afterReply(conversationId, messageIds, outcome);
    } catch (error) {
      // The reply is out and the rows are linked: a failed follow-up must not repeat or fail the turn.
      logger.warn(
        { conversationId, reason: error instanceof Error ? error.name : "unknown" },
        "Agent follow-up failed",
      );
    }
    return "done";
  }
}

/** `WaOutboundService` refuses with CONFLICT when the agent is off or the chat is paused or blocked. */
function isRefusal(error: unknown): boolean {
  return error instanceof AppError && error.code === ErrorCode.CONFLICT;
}
