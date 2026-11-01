import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { t, type Locale } from "@wasfa/shared/i18n";
import {
  type ActionContext,
  type FailureAction,
  type FailureClass,
  type FailureSignal,
  type WaTurnState,
} from "@wasfa/shared/wa-agent/failure";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { ErrorReporter } from "../../common/errors.js";
import { REDIS } from "../../common/redis.js";
import { WaAgentHandoffService } from "../agent/handoff.service.js";
import { WA_AGENT_ROUND } from "../wa-agent.tokens.js";
import { WaOutboundService } from "../wa-outbound.service.js";

import { type AgentRound } from "./agent-round.js";
import { fallbackOutcome, type Carry } from "./carry.js";
import { OWNER_REASONS } from "./failure-policy.js";
import { fallbackTexts } from "./fallback-replies.js";
import { StaleFenceError } from "./lock.js";
import { TurnQueue, type TurnEnqueuer } from "./turn.queue.js";
import { TurnStore, type ActiveTurn } from "./turn.store.js";

import type { WaConversation } from "@wasfa/db";
import type { WaAgentSettings } from "@wasfa/shared/settings";

const DAY_SECONDS = 86_400;
const MINUTE_SECONDS = 60;

const failTextKey = (conversationId: string) => `wa:agent:failtext:${conversationId}`;
const pausedNoticeKey = (conversationId: string, at: Date) =>
  `wa:agent:aipaused:${conversationId}:${at.toISOString().slice(0, 10).replaceAll("-", "")}`;
const ownerAlertKey = (conversationId: string) => `wa:agent:failalert:${conversationId}`;

/** How a failure ending left the run: ended, lost to a newer holder, or retried later. */
export type FailureEnd = "done" | "stale" | "deferred";

export interface FailureRun {
  turn: ActiveTurn;
  conversation: WaConversation;
  config: WaAgentSettings;
  signal: FailureSignal;
  cls: FailureClass;
  /** The caught error (stored with the error event); absent for an empty answer. */
  error: unknown;
  carry: Carry;
  actionContext: ActionContext;
}

const isRefusal = (error: unknown): boolean =>
  error instanceof AppError && error.code === ErrorCode.CONFLICT;

/**
 * Carries out what the failure policy decided (docs/WA-AGENT-RUNTIME.md section 5.4): the customer text
 * (always i18n, one per chat per `failures.customerTextEveryMinutes`), the error reference, the owner
 * alert (rate limited, never a pause) and the way the turn ends. Every write is fenced.
 */
@Injectable()
export class FailureActions {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly store: TurnStore,
    private readonly outbound: WaOutboundService,
    @Inject(WA_AGENT_ROUND) private readonly round: AgentRound,
    @Inject(TurnQueue) private readonly queue: TurnEnqueuer,
    private readonly handoff: WaAgentHandoffService,
    private readonly errors: ErrorReporter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentFailureActions");
  }

  /** The facts `actionFor` needs besides the class: the run so far and the customer-text limit. */
  async contextFor(
    turn: ActiveTurn,
    conversationId: string,
    config: WaAgentSettings,
    cls: FailureClass,
    reasked: boolean,
  ): Promise<ActionContext> {
    let customerTextAllowed: boolean;
    let customerTextInMs = 0;
    if (cls === "spend_cap" || cls === "ai_off") {
      // The paused notice has its own once-a-day limit, apart from the failure texts.
      customerTextAllowed =
        (await this.redis.exists(pausedNoticeKey(conversationId, new Date()))) === 0;
    } else {
      const ttl = await this.redis.pttl(failTextKey(conversationId));
      customerTextAllowed = ttl < 0;
      customerTextInMs = ttl > 0 ? ttl : 0;
    }
    return {
      attempt: turn.attempt,
      jobRetries: config.runtime.jobAttempts,
      // The retry ladder already ran inside the round.
      stepRetriesUsed: 2,
      reasked,
      customerTextAllowed,
      customerTextInMs,
      rateDeferred: turn.rateDeferred,
    };
  }

  /** Ends the turn per `action`; "stale" when another worker owns the conversation now. */
  async execute(
    action: Exclude<FailureAction, { type: "retry_step" } | { type: "reask_without_tools" }>,
    run: FailureRun,
  ): Promise<FailureEnd> {
    try {
      switch (action.type) {
        case "defer":
          return await this.defer(action, run);
        case "fallback_from_tools":
          return await this.fallback(action, run);
        case "fail":
          return await this.fail(action, run);
        case "drop":
          return await this.drop(run);
      }
    } catch (error) {
      if (!(error instanceof StaleFenceError)) throw error;
      this.logger.warn(
        { conversationId: run.turn.conversationId, turnId: run.turn.id, fence: run.turn.fence },
        "Stale fence: failure ending dropped",
      );
      return "stale";
    }
  }

  private end(
    run: FailureRun,
    extra: { errorRef?: string; link: boolean; rateDeferred?: boolean },
  ) {
    const { turn, carry, cls, signal } = run;
    return {
      turnId: turn.id,
      fence: turn.fence,
      inboundIds: turn.inboundIds,
      costUsdMicros: carry.costUsdMicros,
      trace: [{ code: "failure", name: cls }, { code: signal.kind }],
      steps: carry.steps,
      causeClass: cls,
      ...extra,
    };
  }

  private locale(run: FailureRun): Locale {
    return run.config.language === "en" ? "en" : "ar";
  }

  /** Queues `text` under the fence and ends the turn in `state`; a chat paused meanwhile ends it quietly. */
  private async send(
    run: FailureRun,
    parts: { kind: "text"; text: string }[],
    state: WaTurnState,
    end: ReturnType<FailureActions["end"]>,
  ): Promise<string[] | null> {
    try {
      return await this.outbound.enqueueFenced(run.turn.conversationId, parts, end, state);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      this.logger.info({ conversationId: run.turn.conversationId }, "Failure text not queued");
      await this.store.close(run.turn, end, "dropped_policy");
      return null;
    }
  }

  private async markText(run: FailureRun, paused: boolean): Promise<void> {
    const { conversation, config } = run;
    if (paused) {
      await this.redis.set(
        pausedNoticeKey(conversation.id, new Date()),
        "1",
        "EX",
        2 * DAY_SECONDS,
      );
      return;
    }
    await this.redis.set(
      failTextKey(conversation.id),
      "1",
      "EX",
      config.failures.customerTextEveryMinutes * MINUTE_SECONDS,
      "NX",
    );
  }

  private async defer(
    action: Extract<FailureAction, { type: "defer" }>,
    run: FailureRun,
  ): Promise<FailureEnd> {
    const { turn, actionContext: ctx, cls } = run;
    const rateWait =
      !ctx.customerTextAllowed &&
      action.text === null &&
      (cls === "permanent" || ctx.attempt > ctx.jobRetries);
    const end = this.end(run, { link: false, ...(rateWait ? { rateDeferred: true } : {}) });
    if (action.text === null) {
      await this.store.close(turn, end, "deferred");
    } else {
      const text = t(action.text, {}, this.locale(run));
      const ids = await this.send(run, [{ kind: "text", text }], "deferred", end);
      if (ids === null) return "done";
      await this.markText(run, false);
    }
    // The job is complete; the retry is a new delayed job. It must not extend: the delay is the back-off.
    await this.queue.enqueue(turn.conversationId, { delayMs: action.delayMs, extend: false });
    return "deferred";
  }

  private async fallback(
    action: Extract<FailureAction, { type: "fallback_from_tools" }>,
    run: FailureRun,
  ): Promise<FailureEnd> {
    const { turn, conversation, carry } = run;
    const texts = fallbackTexts(carry.toolResults, this.locale(run));
    const text = texts.length > 0 ? texts.join("\n\n") : t(action.otherwise, {}, this.locale(run));
    const ids = await this.send(
      run,
      [{ kind: "text", text }],
      "replied",
      this.end(run, { link: true }),
    );
    if (ids === null) return "done";
    const outcome = fallbackOutcome(conversation, carry, text);
    try {
      // A handoff that already happened still pauses once its reply is delivered (the tool's own rule).
      await this.round.afterReply(turn.conversationId, ids, outcome);
    } catch (error) {
      this.logger.warn(
        {
          conversationId: turn.conversationId,
          reason: error instanceof Error ? error.name : "unknown",
        },
        "Agent follow-up failed",
      );
    }
    return "done";
  }

  private async fail(
    action: Extract<FailureAction, { type: "fail" }>,
    run: FailureRun,
  ): Promise<FailureEnd> {
    const { turn, conversation, cls, signal } = run;
    let errorRef: string | undefined;
    if (action.errorEvent) {
      errorRef = await this.errors.record(run.error ?? new Error(`wa-agent turn failed: ${cls}`), {
        route: "wa-agent-turn",
        method: "JOB",
        requestId: turn.id,
        code: "WA_AGENT_TURN_FAILED",
        userId: conversation.userId ?? undefined,
        context: { failureClass: cls, signal: signal.kind, attempt: turn.attempt },
      });
    }
    const text = t(action.text, { ref: errorRef ?? "" }, this.locale(run));
    const end = this.end(run, { link: true, ...(errorRef === undefined ? {} : { errorRef }) });
    const ids = await this.send(run, [{ kind: "text", text }], "failed_replied", end);
    if (ids === null) return "done";
    await this.markText(run, cls === "spend_cap" || cls === "ai_off");
    if (action.ownerAlert) await this.alertOwner(run, errorRef);
    return "done";
  }

  private async drop(run: FailureRun): Promise<FailureEnd> {
    const reason = run.signal.kind === "policy" ? run.signal.reason : run.cls;
    await this.store.close(
      run.turn,
      { ...this.end(run, { link: true }), trace: [{ code: "dropped", name: reason }] },
      "dropped_policy",
    );
    this.logger.info(
      { conversationId: run.turn.conversationId, turnId: run.turn.id, reason },
      "Agent turn dropped by policy",
    );
    return "done";
  }

  /** At most one alert per chat per `failures.ownerAlertEveryMinutes`; it never pauses or silences the chat. */
  private async alertOwner(run: FailureRun, errorRef: string | undefined): Promise<void> {
    const { conversation, config, cls } = run;
    const first = await this.redis.set(
      ownerAlertKey(conversation.id),
      "1",
      "EX",
      config.failures.ownerAlertEveryMinutes * MINUTE_SECONDS,
      "NX",
    );
    if (first !== "OK") return;
    const reason =
      errorRef === undefined ? OWNER_REASONS[cls] : `${OWNER_REASONS[cls]} (${errorRef})`;
    await this.handoff.alertOwner(conversation.id, reason);
  }
}
