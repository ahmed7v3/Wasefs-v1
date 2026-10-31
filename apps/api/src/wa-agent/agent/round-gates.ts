import { ToolLoopError } from "@wasfa/ai";

import { RoundRefused, type StepTrace } from "../turn/agent-round.js";

import { addSpend, spendKey, withOutcomes, type ComposeInput } from "./round-helpers.js";

import type { ToolCallRecord, ToolOutput } from "./tools/index.js";
import type { AiRuntimeService } from "../../ai-runtime/ai-runtime.service.js";
import type { PlansService } from "../../plans/plans.service.js";
import type { WaAgentRepo } from "../conversation/conversation.repo.js";
import type { TurnUser } from "@wasfa/db";
import type { Redis } from "ioredis";
import type { PinoLogger } from "nestjs-pino";

/**
 * Identity: linked = the chat's account is active; a guest needs `guestsEnabled`. Then the daily spend
 * cap, the plan and the AI availability check. Null = stay quiet; throws `RoundRefused` otherwise.
 */
export async function admitRound(
  deps: { repo: WaAgentRepo; redis: Redis; plans: PlansService; ai: AiRuntimeService },
  input: ComposeInput,
): Promise<{ user: TurnUser | null; planId: string | null } | null> {
  const { conversation, config, now } = input;
  const user =
    conversation.userId === null ? null : await deps.repo.findUser(conversation.userId);
  if (conversation.userId !== null && user?.status !== "active") {
    throw new RoundRefused({ kind: "account_unavailable" });
  }
  if (conversation.userId === null && !config.guestsEnabled) return null;

  const spent = Number((await deps.redis.get(spendKey(now))) ?? 0);
  if (spent >= config.spendCapUsdMicros) {
    throw new RoundRefused({
      kind: "busy",
      cause: "spend_cap",
      detail: { spentUsdMicros: spent, capUsdMicros: config.spendCapUsdMicros },
    });
  }
  const planId =
    conversation.userId === null
      ? null
      : (await deps.plans.effectivePlan({ type: "user", id: conversation.userId }, now)).id;
  try {
    await deps.ai.assertAvailable("wa_agent", { search: false });
  } catch (error) {
    throw new RoundRefused({
      kind: "busy",
      cause: "ai_unavailable",
      detail: { errorName: error instanceof Error ? error.name : "unknown" },
    });
  }
  return { user, planId };
}

/** The tool loop failed: books what it cost, logs why and builds the refusal the caller throws. */
export async function refusalAfterLoop(
  deps: { redis: Redis; logger: PinoLogger },
  error: unknown,
  state: {
    input: ComposeInput;
    records: ToolCallRecord[];
    outputs: ToolOutput[];
    stepTraces: readonly StepTrace[];
    ctx: { handoffReason: string | null };
  },
): Promise<RoundRefused> {
  const { input, records, outputs, stepTraces, ctx } = state;
  if (error instanceof ToolLoopError) await addSpend(deps.redis, error.costUsdMicros, input.now);
  // The original failure, not the wrapper: a timeout reads "TimeoutError", a provider error its code.
  const cause = error instanceof ToolLoopError ? error.cause : error;
  const detail = {
    errorName: cause instanceof Error ? cause.name : "unknown",
    code: error instanceof ToolLoopError ? error.code : undefined,
    steps: error instanceof ToolLoopError ? error.steps : undefined,
    toolsRan: records.length,
  };
  deps.logger.warn(
    {
      conversationId: input.conversation.id,
      ...detail,
      tools: records.map((record) => record.name),
    },
    "Agent turn failed",
  );
  return new RoundRefused(
    { kind: "busy", cause: "model_failed", detail },
    {
      cause,
      toolRecords: records,
      toolResults: outputs,
      costUsdMicros: error instanceof ToolLoopError ? error.costUsdMicros : 0,
      steps: withOutcomes(stepTraces, records),
      handoffReason: ctx.handoffReason,
    },
  );
}
