import { Inject, Injectable } from "@nestjs/common";
import { runToolLoop, type ToolLoopResult } from "@wasfa/ai";
import { newId } from "@wasfa/shared/ids";
import { WA_AGENT_MAX_TEXT } from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { AiRuntimeService } from "../../ai-runtime/ai-runtime.service.js";
import { REDIS } from "../../common/redis.js";
import { PlansService } from "../../plans/plans.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";
import { WaAgentStateService } from "../conversation/state.service.js";
import { ladderRetry } from "../turn/retry-ladder.js";
import { WaAgentVoiceService } from "../voice/voice.service.js";

import { phoneMarket } from "./agent-market.js";
import { toWhatsappText } from "./agent-output.js";
import { buildHistory } from "./agent-prompt.js";
import { roundSystemPrompt, roundToolContext, roundTurnSignal } from "./context.js";
import { WaAgentHandoffService, handoffFlagKey } from "./handoff.service.js";
import { MediaInputService } from "./media-input.js";
import { callWithRetry, type StepRun } from "./model-step.js";
import { admitRound, refusalAfterLoop } from "./round-gates.js";
import {
  HISTORY_LIMIT,
  MAX_TOOL_CALLS_PER_STEP,
  addSpend,
  answerFloor,
  quietOutcome,
  type ComposeInput,
  type TurnTiming,
} from "./round-helpers.js";
import { roundOutcome, speakReply } from "./round-outcome.js";
import { SummaryService } from "./summary.service.js";
import { WaAgentToolDeps } from "./tool-deps.js";
import { bindTools, toolsFor, type ToolCallRecord, type ToolOutput } from "./tools/index.js";

import type { AgentRound, ComposeOptions, RoundOutcome, StepTrace } from "../turn/agent-round.js";
import type { WaConversation, TurnMessage } from "@wasfa/db";

const MAX_STEPS = 5;

/**
 * One round of the WhatsApp agent, shared by v1 (`WaAgentTurnService.runTurn`) and v2 (`TurnRunner`):
 * identity and standing, spend and availability checks, the prompt, the tool loop, the voice decision and
 * the parts. Logs ids, counts, tool names and cost: never phone numbers, message texts, tool arguments
 * or results. It owns the state both entry points share: the clock, the spend counter in Redis and the
 * follow-up jobs in flight.
 */
@Injectable()
export class AgentRoundService implements AgentRound {
  readonly timing: TurnTiming = {
    quietMs: 2_500,
    maxQuietWaitMs: 8_000,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    now: () => Date.now(),
  };
  /** Replaced by tests: decides the "sometimes" voice replies. */
  random: () => number = () => Math.random();
  private readonly background = new Set<Promise<void>>();

  constructor(
    private readonly repo: WaAgentRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ai: AiRuntimeService,
    private readonly handoff: WaAgentHandoffService,
    private readonly toolDeps: WaAgentToolDeps,
    private readonly plans: PlansService,
    private readonly logger: PinoLogger,
    private readonly voice: WaAgentVoiceService,
    private readonly media: MediaInputService,
    private readonly summary: SummaryService,
  ) {
    this.logger.setContext("WaAgentTurn");
  }

  /** Resolves when the follow-up work started so far (summaries) has finished. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.background]);
  }

  /**
   * The v2 entry (`AgentRound`): the checks v1 makes before it reads the chat, then the shared round. The
   * caller hands over the unanswered customer messages; none of them is stamped here (v2 links them in
   * the transaction that queues the reply).
   */
  async compose(
    conversation: WaConversation,
    pending: readonly TurnMessage[],
    signal: AbortSignal,
    options: ComposeOptions = {},
  ): Promise<RoundOutcome> {
    const config = await this.settings.get("waAgent");
    const now = new Date(this.timing.now());
    const quiet = () => quietOutcome(conversation, now);
    if (!config.enabled || WaAgentStateService.isHeld(conversation)) return quiet();
    if ((await this.redis.exists(handoffFlagKey(conversation.id))) === 1) return quiet();
    const rows = await this.repo.recentMessages(conversation.id, HISTORY_LIMIT);
    const floor = answerFloor(rows, now.getTime());
    const eligible = pending.filter((row) => row.createdAt.getTime() > floor);
    if (eligible.length === 0) return quiet();
    const outcome = await this.composeReply({
      conversation,
      pending: eligible,
      rows,
      config,
      now,
      signal,
      limits: { stepMs: config.runtime.stepTimeoutMs, turnMs: config.runtime.turnTimeoutMs },
      stepRetry: ladderRetry((ms) => this.timing.sleep(ms)),
      ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
      ...(options.fence === undefined ? {} : { fence: options.fence }),
      reaskFrom: options.reaskFrom,
    });
    return outcome ?? quiet();
  }

  /** After the parts were queued as `messageIds` (none when the round had nothing to say). */
  async afterReply(
    conversationId: string,
    messageIds: readonly string[],
    outcome: RoundOutcome,
  ): Promise<void> {
    const { tail } = outcome;
    if (messageIds.length > 0) {
      await this.repo.setMeta(messageIds, {
        tools: outcome.toolRecords,
        steps: tail.steps,
        costUsdMicros: outcome.costUsdMicros,
        truncated: tail.truncated,
      });
      const voiceRowId = messageIds[0];
      if (tail.spoken && voiceRowId !== undefined) {
        // The words stay on the row: the inbox shows them and the next turn reads what was said.
        // ElevenLabs characters are counted apart from the AI spend (their own daily cap).
        await this.repo.setText(voiceRowId, toWhatsappText(tail.text).slice(0, WA_AGENT_MAX_TEXT), {
          voice: { chars: tail.spoken.chars },
        });
      }
    }
    if (tail.handoffReason !== null) this.handoff.pauseWhenDelivered(conversationId, messageIds);
    this.track(this.summary.refreshSummary(tail.conversation, tail.planId, tail.now));
  }

  async discard(outcome: RoundOutcome): Promise<void> {
    if (outcome.tail.spoken) await this.voice.discard(outcome.tail.spoken.mediaKey);
  }

  /**
   * One round, shared by v1 and v2. Returns null when the agent must stay quiet, throws `RoundRefused`
   * for the cases v1 answers with a polite line. Queues nothing and marks nothing.
   */
  async composeReply(input: ComposeInput): Promise<RoundOutcome | null> {
    const { conversation, pending, rows, config, now, limits } = input;

    const admitted = await admitRound(
      { repo: this.repo, redis: this.redis, plans: this.plans, ai: this.ai },
      input,
    );
    if (admitted === null) return null;
    const { user, planId } = admitted;

    const requestId = newId();
    await input.onTaken?.(
      pending.map((message) => message.id),
      requestId,
    );
    const market = phoneMarket(conversation.phone, await this.settings.get("currency"));
    const medications = await this.settings.get("medications");
    const medicationTools = medications.enabled && medications.waTools;
    // Account creation from the chat needs both switches (docs/WA-SIGNUP.md section 3).
    const auth = await this.settings.get("auth");
    const accountTools = auth.whatsappLogin && auth.whatsappAgentSignup;
    const system = roundSystemPrompt({
      switches: { medications: medicationTools, accountSignup: accountTools },
      webOrigin: this.toolDeps.webOrigin ?? "",
      config,
      now,
      user,
      market,
      conversation,
    });
    // A re-ask continues the conversation the first pass built (its tool results included).
    const messages =
      input.reaskFrom !== undefined
        ? [...input.reaskFrom]
        : buildHistory(
            await this.media.transcribePending(rows, pending, config),
            await this.media.loadImages(pending),
          );

    const records: ToolCallRecord[] = [];
    const outputs: ToolOutput[] = [];
    const stepTraces: StepTrace[] = [];
    const ctx = roundToolContext({
      conversation,
      user,
      market,
      config,
      now,
      deps: this.toolDeps,
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      ...(input.fence === undefined ? {} : { fence: input.fence }),
    });
    const { definitions, handlers } = bindTools(
      toolsFor(user !== null, { medications: medicationTools, accountSignup: accountTools }),
      ctx,
      records,
      outputs,
    );
    const turnSignal = roundTurnSignal(input.signal, limits.turnMs);

    const stepRun: StepRun = {
      ai: this.ai,
      input,
      conversation,
      system,
      planId,
      requestId,
      records,
      stepTraces,
      turnSignal,
    };
    let result: ToolLoopResult;
    try {
      result = await runToolLoop({
        messages,
        tools: definitions,
        handlers,
        maxSteps: MAX_STEPS,
        maxToolCallsPerStep: MAX_TOOL_CALLS_PER_STEP,
        call: (step) => callWithRetry(stepRun, step),
      });
    } catch (error) {
      throw await refusalAfterLoop({ redis: this.redis, logger: this.logger }, error, {
        input,
        records,
        outputs,
        stepTraces,
        ctx,
      });
    }
    await addSpend(this.redis, result.costUsdMicros, now);
    this.logger.info(
      {
        conversationId: conversation.id,
        steps: result.steps,
        toolCalls: records.map((record) => record.name),
        costUsdMicros: result.costUsdMicros,
        truncated: result.truncated,
      },
      "Agent turn done",
    );

    const spoken = await speakReply(
      { voice: this.voice, random: this.random },
      result.text,
      ctx.mediaParts,
      pending,
      config,
      now,
    );
    return roundOutcome({
      result,
      spoken,
      config,
      conversation,
      planId,
      now,
      records,
      outputs,
      stepTraces,
      ctx,
    });
  }

  /** Follow-up work never delays or fails a reply: a failure is logged and forgotten. */
  private track(job: Promise<void>): void {
    const tracked: Promise<void> = job
      .catch((error: unknown) => {
        this.logger.warn(
          { reason: error instanceof Error ? error.name : "unknown" },
          "Agent follow-up failed",
        );
      })
      .finally(() => {
        this.background.delete(tracked);
      });
    this.background.add(tracked);
  }
}
