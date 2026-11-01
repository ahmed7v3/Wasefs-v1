import { collectCompletion, type RouterEvent, type ToolLoopCallInput } from "@wasfa/ai";

import { AiRuntimeService } from "../../ai-runtime/ai-runtime.service.js";
import { effectsRanOf, type StepTrace } from "../turn/agent-round.js";
import { signalOf } from "../turn/failure-policy.js";

import { promptChars } from "./agent-prompt.js";

import type { ComposeInput } from "./round-helpers.js";
import type { ToolCallRecord } from "./tools/index.js";
import type { WaConversation } from "@wasfa/db";

const MAX_OUTPUT_TOKENS = 1_024;

/** What one model step needs besides the loop's own input; `stepTraces` and `records` fill as the loop runs. */
export interface StepRun {
  ai: AiRuntimeService;
  input: ComposeInput;
  conversation: WaConversation;
  system: string;
  planId: string | null;
  requestId: string;
  records: readonly ToolCallRecord[];
  stepTraces: StepTrace[];
  turnSignal: AbortSignal;
}

/**
 * One loop step with its retry policy. A failed step may be run again (v1: one retry of a provider error
 * before any tool; v2: the ladder, only before an effect). The decision lives in `input.stepRetry`.
 */
export async function callWithRetry(run: StepRun, step: ToolLoopCallInput) {
  for (let retriesUsed = 0; ; retriesUsed++) {
    try {
      return await runStep(run, step);
    } catch (error) {
      const again = await run.input.stepRetry({
        error,
        retriesUsed,
        effectsRan: effectsRanOf(run.records),
        toolsRan: !step.allowFallback,
        turnSignal: run.turnSignal,
      });
      if (!again) throw error;
    }
  }
}

async function runStep(run: StepRun, step: ToolLoopCallInput) {
  const { ai, input, conversation, system, planId, requestId, stepTraces, turnSignal } = run;
  const seen: { model?: string; routeVersion?: number } = {};
  const started = Date.now();
  // Each step has its own limit, and every step stops when the whole turn runs out.
  const stepSignal = AbortSignal.any([turnSignal, AbortSignal.timeout(input.limits.stepMs)]);
  try {
    const completion = await collectCompletion(
      tap(
        ai.run(
          {
            task: "wa_agent",
            mode: "balanced",
            planId,
            request: {
              system,
              messages: step.messages,
              tools: step.tools,
              toolChoice: input.reaskFrom === undefined ? step.toolChoice : "none",
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            },
            ownerUserId: conversation.userId,
            userId: conversation.userId,
            requestId,
            estimateInputTokens: Math.ceil(promptChars(system, step.messages) / 3),
            // Once a tool ran, a different model must not take over the half-done turn.
            noFallback: !step.allowFallback,
          },
          stepSignal,
        ),
        seen,
      ),
    );
    // An aborted stream ends quietly; that is a timeout, not an empty answer.
    if (stepSignal.aborted) throw stepSignal.reason;
    stepTraces.push({
      step: stepTraces.length + 1,
      ...(seen.model === undefined ? {} : { model: seen.model }),
      ...(seen.routeVersion === undefined ? {} : { routeVersion: seen.routeVersion }),
      latencyMs: Date.now() - started,
      ...(completion.usage === undefined
        ? {}
        : {
            tokens: {
              input: completion.usage.inputTokens,
              output: completion.usage.outputTokens,
            },
          }),
      costUsdMicros: completion.costUsdMicros,
      tools: completion.toolCalls.map((call) => ({
        tool: call.name,
        outcome: "pending",
      })),
    });
    return completion;
  } catch (error) {
    stepTraces.push({
      step: stepTraces.length + 1,
      latencyMs: Date.now() - started,
      tools: [],
      error: signalOf(error, { turnSignal }).kind,
    });
    throw error;
  }
}

/** Passes the router's events through and notes which model answered. */
async function* tap(
  events: AsyncIterable<RouterEvent>,
  seen: { model?: string; routeVersion?: number },
): AsyncGenerator<RouterEvent> {
  for await (const event of events) {
    if (event.type === "result") {
      seen.model = event.result.modelId;
      seen.routeVersion = event.result.routeVersion;
    }
    yield event;
  }
}
