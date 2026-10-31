import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { actionFor, classify, type FailureSignal } from "@wasfa/shared/wa-agent/failure";
import { PinoLogger } from "nestjs-pino";

import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentRepo } from "../wa-agent.repo.js";
import { WA_AGENT_ROUND } from "../wa-agent.tokens.js";
import { WaOutboundService } from "../wa-outbound.service.js";

import {
  RoundRefused,
  effectsRanOf,
  type AgentRound,
  type ComposeOptions,
  type RoundOutcome,
} from "./agent-round.js";
import { carryOf, carryOfFailure, emptyCarry, mergeOutcome, type Carry } from "./carry.js";
import { FailureActions } from "./failure-actions.js";
import { signalOf } from "./failure-policy.js";
import { ConversationLock, StaleFenceError } from "./lock.js";
import { TurnQueue, type TurnEnqueuer } from "./turn.queue.js";
import { TurnStore, type ActiveTurn } from "./turn.store.js";

import type { WaConversation, TurnMessage } from "@wasfa/db";
import type { WaAgentSettings } from "@wasfa/shared/settings";

/** How a run ended: `busy` = another worker holds the conversation, `stale` = our lock was taken over, `deferred` = a retry is scheduled. */
export type RunResult = "idle" | "answered" | "busy" | "stale" | "deferred";

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
  failures: Pick<FailureActions, "contextFor" | "execute">;
  logger: Pick<PinoLogger, "warn" | "info">;
}

type RoundEnd = "done" | "stale" | "deferred";

/**
 * One v2 job for one conversation (docs/WA-AGENT-RUNTIME.md §4.3, §17): take the conversation lock and its
 * fence, then drain: each round answers every customer message that is still unanswered, until none is left
 * or `runtime.maxRounds` rounds ran. Every round ends `replied`, `deferred`, `failed_replied` or
 * `dropped_policy` (§5.4); a failure never leaves the customer in silence. Messages that arrive after the
 * last look are caught by the re-check after the lock is released, which queues another job.
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
    failures: FailureActions,
    logger: PinoLogger,
  ) {
    logger.setContext("WaAgentTurnRunner");
    this.ports = { lock, store, conversations, settings, round, outbound, queue, failures, logger };
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
    // A deferred turn already has its delayed retry job; queueing now would skip the back-off.
    if (result === "stale" || result === "deferred") return result;
    // A message that arrived between the last look and the release still gets its turn.
    if (await store.hasUnanswered(conversationId)) {
      logger.info({ conversationId }, "Unanswered messages after the turn; queued again");
      await queue.enqueue(conversationId);
    }
    return result;
  }

  private async drain(conversationId: string, lockLost: AbortSignal): Promise<RunResult> {
    const { store, conversations, settings } = this.ports;
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
      const ended = await this.answer(turn, conversation, unanswered, config, signal, lockLost);
      if (ended !== "done") return ended;
      result = "answered";
    }
    return result;
  }

  /** One round: compose, and when it fails or says nothing, the failure policy decides how it ends. */
  private async answer(
    turn: ActiveTurn,
    conversation: WaConversation,
    unanswered: readonly TurnMessage[],
    config: WaAgentSettings,
    signal: AbortSignal,
    lockLost: AbortSignal,
  ): Promise<RoundEnd> {
    const { round, failures } = this.ports;
    let carry: Carry = emptyCarry();
    let options: ComposeOptions = { turnId: turn.id, fence: turn.fence };
    let reasked = false;
    for (;;) {
      let failure: FailureSignal;
      let error: unknown;
      try {
        const outcome = await round.compose(conversation, unanswered, signal, options);
        const merged = mergeOutcome(carry, outcome);
        if (outcome.parts.length > 0 || outcome.skipped === true)
          return await this.finish(turn, merged);
        // The model finished without a word for the customer.
        failure = { kind: "empty_answer" };
        carry = carryOf(carry, outcome);
        options = {
          ...options,
          ...(outcome.transcript === undefined ? {} : { reaskFrom: outcome.transcript }),
        };
      } catch (caught) {
        // Another holder owns the chat now (lock lost or fence taken): stop quietly, send nothing.
        if (caught instanceof StaleFenceError || lockLost.aborted) return this.stale(turn);
        error = caught;
        failure = signalOf(caught, { turnSignal: signal });
        if (caught instanceof RoundRefused && caught.failure !== undefined) {
          carry = carryOfFailure(carry, caught.failure);
        }
      }
      const cls = classify(failure, { effectsRan: effectsRanOf(carry.toolRecords) });
      const actionContext = await failures.contextFor(turn, conversation.id, config, cls, reasked);
      const action = actionFor(cls, actionContext);
      const run = { turn, conversation, config, signal: failure, cls, error, carry, actionContext };
      if (action.type === "reask_without_tools" && options.reaskFrom !== undefined) {
        reasked = true;
        continue;
      }
      if (action.type === "retry_step" || action.type === "reask_without_tools") {
        // The ladder ran inside the round, and a re-ask needs the first pass's conversation.
        const next = actionFor(cls, { ...actionContext, reasked: true, stepRetriesUsed: 2 });
        if (next.type === "retry_step" || next.type === "reask_without_tools") {
          throw new Error("failure policy did not end the turn");
        }
        return failures.execute(next, run);
      }
      return failures.execute(action, run);
    }
  }

  private stale(turn: ActiveTurn): "stale" {
    this.ports.logger.warn(
      { conversationId: turn.conversationId, turnId: turn.id, fence: turn.fence },
      "Stale fence: turn dropped",
    );
    return "stale";
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
      this.stale(turn);
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
